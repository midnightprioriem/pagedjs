import {getBoundingClientRect, getClientRects} from "../utils/utils";
import {
	breakInsideAvoidParentNode,
	child,
	cloneNode,
	findElement,
	hasContent,
	indexOf,
	indexOfTextNode,
	isContainer,
	isElement,
	isText,
	isFlexElement,
	letters,
	needsBreakBefore,
	needsPageBreak,
	needsPreviousBreakAfter,
	nodeAfter,
	nodeBefore,
	parentOf,
	previousSignificantNode,
	prevValidNode,
	rebuildAncestors2,
	validNode,
	walk,
	words
} from "../utils/dom";
import BreakToken  from "./breaktoken";
import EventEmitter from "event-emitter";
import Hook from "../utils/hook";

const MAX_CHARS_PER_BREAK = 1500;

/**
 * Layout
 * @class
 */
class Layout {

	constructor(element, hooks, options) {
		this.element = element;

		this.bounds = this.element.getBoundingClientRect();

		if (hooks) {
			this.hooks = hooks;
		} else {
			this.hooks = {};
			this.hooks.layout = new Hook();
			this.hooks.renderNode = new Hook();
			this.hooks.layoutNode = new Hook();
			this.hooks.beforeOverflow = new Hook();
			this.hooks.onOverflow = new Hook();
			this.hooks.onBreakToken = new Hook();
		}

		this.settings = options || {};

		// Temporarily setting this value to a huge number so we basically process the entire page on every 'staged' page
		// Otherwise, it will hit 1500 characters (default) and then stop staging content, leading to missing elements
		// and missed overflow discoveries
		this.maxChars = 1000000000000000000000000;
		// this.maxChars = this.settings.maxChars || MAX_CHARS_PER_BREAK;
		this.forceRenderBreak = false;
	}

	async renderTo(wrapper, source, breakTokens, bounds = this.bounds) {

		// Summary of how renderTo originally works:
		// We get a single breaktoken. From that breaktoken, we find all direct ancestors and append them to the 'stage'
		//		Note: We also use breaktoken information to append a subset of its text content
		// Then, starting at the breakToken, we walk the DOM until one of these potential break conditions are hit:
		// 		1 - dataset breakbefore is set (triggers shouldBreak)
		// 		2 - forceRenderBreak is true (??? don't know why)
		// 		3 - character length exceeds max
		// 		4 - the nodewalker finds null because we've walked to the end
		// Once that is hit, we trigger findBreakToken(), which calls findOverflow(), which starts at the top of the 'staged' content and rewalks the DOM to locate where the page overflows.
		// findBreakToken() additionally 'cuts off' any content beyond the overflow (in removeOverflow() overflow.extractContents())
		// 		See: https://developer.mozilla.org/en-US/docs/Web/API/Range/extractContents
		// Finally, the breakToken is returned, and page creation code is called for a new page


		// Summary of the changes made:
		// We are passed in a list of breaktokens. For each breaktoken, we find all direct ancestors and append them to the 'stage.'
		//		Note: We also use breaktoken information to append a subset of its text content
		// Note that we track whether an item already exists on a stage, in the case of breaktokens being related. If a breaktoken
		// has a flexParent, we additionally locate siblings and append them to the 'stage' as well, ignoring textnodes.
		// Then, starting at the first breaktoken's node, we walk the DOM until one of these potential break conditions are hit:
		// 		1 - dataset breakbefore is set (triggers shouldBreak)
		// 		2 - forceRenderBreak is true (??? don't know why)
		// 		X/3 - character length exceeds max (TURNED OFF)
		// 		4 - the nodewalker finds null because we've walked to the end (this is what's happening on my local. This seems terrible for performance for Salesforce)
		// Once that is hit, we trigger findBreakToken(), which calls findOverflow(), which starts at the top of the 'staged' content and rewalks the DOM to locate where the page overflows.
		// As we walk, if we encounter a flex element, we track it and if we find a breaktoken while inside of that flex element, we add that information to the breaktoken
		// as flexParent, which is leveraged later. Additionally, each breaktoken contains a Range object. In the original implementation, rangeEnd is set in such a way to
		// cut off content beyond the overflow. In these modifications, rangeEnd is only set on the LAST breaktoken, ensuring that we do not cut off any earlier content.
		// Finally, the breaktokens are returned, and page creation code is called for a new page

		// Special note: For the FIRST Loop
		// Original implementation - passes 'false' for breaktoken, which makes walkers start walking at the top of the DOM
		// Changes - passes ['false'], which on the first loop, makes walkers start walking at the top of the DOM

		let start = this.getStart(source, breakTokens[0]);
		let walker = walk(start, source);

		let node;
		let prevNode;
		let done;
		let next;

		let hasRenderedContent = false;
		let newBreakTokens;

		let length = 0;

		// UNSURE if it is okay to assign prevBreakToken to the first break token
		let prevBreakToken = breakTokens[0] || new BreakToken(start);

		this.rebuildAllAncestorsForBreakTokens(breakTokens, wrapper, start);
		
		while (!done && !newBreakTokens) {
			next = walker.next();
			prevNode = node;
			node = next.value;
			done = next.done;

			if (!node) {
				this.hooks && this.hooks.layout.trigger(wrapper, this);

				let imgs = wrapper.querySelectorAll("img");
				if (imgs.length) {
					await this.waitForImages(imgs);
				}

				newBreakTokens = this.findBreakTokens(wrapper, source, bounds, prevBreakToken);

				for (let i = 0; i < newBreakTokens.length; i++) {
					let newBreakToken = newBreakTokens[i];
					if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
						console.warn("Unable to layout item: ", prevNode);
						return undefined;
					}
				}
				return newBreakTokens;
			}
			this.hooks && this.hooks.layoutNode.trigger(node);

			// Check if the rendered element has a break set
			if (hasRenderedContent && this.shouldBreak(node)) {
				this.hooks && this.hooks.layout.trigger(wrapper, this);

				let imgs = wrapper.querySelectorAll("img");
				if (imgs.length) {
					await this.waitForImages(imgs);
				}

				newBreakTokens = this.findBreakTokens(wrapper, source, bounds, prevBreakToken);

				if (!newBreakTokens || newBreakTokens.length === 0) {
					let newBreakToken = this.breakAt(node);
					newBreakTokens.push(newBreakToken);
				}

				for (let i = 0; i < newBreakTokens.length; i++) {
					let newBreakToken = newBreakTokens[i];
					if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
						console.warn("Unable to layout item: ", prevNode);
						return undefined;
					}
				}

				length = 0;

				break;
			}

			// Should the Node be a shallow or deep clone
			let shallow = isContainer(node);
			let rendered = this.append(node, wrapper, breakTokens, shallow);

			length += rendered ? rendered.textContent.length : 0;

			// Check if layout has content yet
			if (!hasRenderedContent) {
				hasRenderedContent = hasContent(node);
			}

			// Skip to the next node if a deep clone was rendered
			if (!shallow) {
				walker = walk(nodeAfter(node, source), source);
			}

			if (this.forceRenderBreak) {
				this.hooks && this.hooks.layout.trigger(wrapper, this);

				newBreakTokens = this.findBreakTokens(wrapper, source, bounds, prevBreakToken);

				if (!newBreakTokens || newBreakTokens.length === 0) {
					let newBreakToken = this.breakAt(node);
					newBreakTokens.push(newBreakToken);
				}

				length = 0;
				this.forceRenderBreak = false;

				break;
			}

			if (length >= this.maxChars) {

				this.hooks && this.hooks.layout.trigger(wrapper, this);

				let imgs = wrapper.querySelectorAll("img");
				if (imgs.length) {
					await this.waitForImages(imgs);
				}

				newBreakTokens = this.findBreakTokens(wrapper, source, bounds, prevBreakToken);

				for (let i = 0; i < newBreakTokens.length; i++) {
					let newBreakToken = newBreakTokens[i];
					if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
						console.warn("Unable to layout item: ", prevNode);
						return undefined;
					}
				}

				if (newBreakTokens && newBreakTokens.length > 0) {
					length = 0;
				}
			}
		}
		return newBreakTokens;
	}

	breakAt(node, offset = 0) {
		let newBreakToken = new BreakToken(
			node,
			offset
		);
		let breakHooks = this.hooks.onBreakToken.triggerSync(newBreakToken, undefined, node, this);
		breakHooks.forEach((newToken) => {
			if (typeof newToken != "undefined") {
				newBreakToken = newToken;
			}
		});

		return newBreakToken;
	}

	shouldBreak(node) {
		let previousSibling = previousSignificantNode(node);
		let parentNode = node.parentNode;
		let parentBreakBefore = needsBreakBefore(node) && parentNode && !previousSibling && needsBreakBefore(parentNode);
		let doubleBreakBefore;

		if (parentBreakBefore) {
			doubleBreakBefore = node.dataset.breakBefore === parentNode.dataset.breakBefore;
		}

		return !doubleBreakBefore && needsBreakBefore(node) || needsPreviousBreakAfter(node) || needsPageBreak(node, previousSibling);
	}

	forceBreak() {
		this.forceRenderBreak = true;
	}

	getStart(source, breakToken) {
		let start;
		let node = breakToken && breakToken.node;

		if (node) {
			start = node;
		} else {
			start = source.firstChild;
		}

		return start;
	}

	append(node, dest, breakTokens, shallow = true, rebuild = true) {
		for (let i = 0; i < breakTokens.length; i++) {
			if (breakTokens[i].node === node) {
				return;
			}
		}
		if (node && node.dataset && node.dataset.doneRendering === "true") {
			return;
		}
		// if (breakTokens && !breakTokens[0]) {
		let clone = findElement(node, dest);
		// As append works off of elements AFTER breaktokens, none of them should already be staged

		if (!clone) {
			clone = cloneNode(node, !shallow);
	
			if (node.parentNode && isElement(node.parentNode)) {
				let parent = findElement(node.parentNode, dest);
				// Rebuild chain
				if (parent) {
					parent.appendChild(clone);
				} else {
					dest.appendChild(clone);
				}
			} else {
				dest.appendChild(clone);
			}
	
			let nodeHooks = this.hooks.renderNode.triggerSync(clone, node, this);
			nodeHooks.forEach((newNode) => {
				if (typeof newNode != "undefined") {
					clone = newNode;
				}
			});
		}
		return clone;
		// }
	}

	rebuildAllAncestorsForBreakTokens(breakTokens, dest, node, shallow = true) {
		if (!breakTokens) {
			return;
		}
		let nodeToUse;
		if (breakTokens && !breakTokens[0]) { // First loop breaktoken is false - start at 1st node
			nodeToUse = node;
		}

		let fragment = rebuildAncestors2(breakTokens);
		
		for (let j = 0; j < breakTokens.length; j++) {
			let breakToken = breakTokens[j];
			if (breakToken && breakToken.node) {
				nodeToUse = breakToken.node;
			}
			let clonedNode = cloneNode(nodeToUse, !shallow);
			let parent = findElement(nodeToUse.parentNode, fragment);
			if (!parent) {
				dest.appendChild(clonedNode);
			} else if (breakToken && isText(nodeToUse) && breakToken.offset > 0) {
				clonedNode.textContent = clonedNode.textContent.substring(breakToken.offset);
				parent.appendChild(clonedNode);
			} else {
				parent.appendChild(clonedNode);
			}
		}
		// Append ancestor fragment to wrapper dest
		dest.appendChild(fragment);
	}

	async waitForImages(imgs) {
		let results = Array.from(imgs).map(async (img) => {
			return this.awaitImageLoaded(img);
		});
		await Promise.all(results);
	}

	async awaitImageLoaded(image) {
		return new Promise(resolve => {
			if (image.complete !== true) {
				image.onload = function () {
					let {width, height} = window.getComputedStyle(image);
					resolve(width, height);
				};
				image.onerror = function (e) {
					let {width, height} = window.getComputedStyle(image);
					resolve(width, height, e);
				};
			} else {
				let {width, height} = window.getComputedStyle(image);
				resolve(width, height);
			}
		});
	}

	avoidBreakInside(node, limiter) {
		let breakNode;

		if (node === limiter) {
			return;
		}

		while (node.parentNode) {
			node = node.parentNode;

			if (node === limiter) {
				break;
			}

			if (window.getComputedStyle(node)["break-inside"] === "avoid") {
				breakNode = node;
				break;
			}

		}
		return breakNode;
	}

	createBreakToken(overflowInfo, rendered, source) {
		let overflow = overflowInfo.range;
		let flexParent = overflowInfo.flexParent;
		if (!overflow) {
			return;
		}
		let container = overflow.startContainer;
		let offset = overflow.startOffset;
		let node, renderedNode, parent, index, temp;

		if (isElement(container)) {
			temp = child(container, offset);

			if (isElement(temp)) {
				renderedNode = findElement(temp, rendered);

				if (!renderedNode) {
					// Find closest element with data-ref
					let prevNode = prevValidNode(temp);
					if (!isElement(prevNode)) {
						prevNode = prevNode.parentElement;
					}
					renderedNode = findElement(prevNode, rendered);
					// Check if temp is the last rendered node at its level.
					if (!temp.nextSibling) {
						// We need to ensure that the previous sibling of temp is fully rendered.
						const renderedNodeFromSource = findElement(renderedNode, source);
						const walker = document.createTreeWalker(renderedNodeFromSource, NodeFilter.SHOW_ELEMENT);
						const lastChildOfRenderedNodeFromSource = walker.lastChild();
						const lastChildOfRenderedNodeMatchingFromRendered = findElement(lastChildOfRenderedNodeFromSource, rendered);
						// Check if we found that the last child in source
						if (!lastChildOfRenderedNodeMatchingFromRendered) {
							// Pending content to be rendered before virtual break token
							return;
						}
						// Otherwise we will return a break token as per below
					}
					// renderedNode is actually the last unbroken box that does not overflow.
					// Break Token is therefore the next sibling of renderedNode within source node.
					node = findElement(renderedNode, source).nextSibling;
					offset = 0;
				} else {
					node = findElement(renderedNode, source);
					offset = 0;
				}
			} else {
				renderedNode = findElement(container, rendered);

				if (!renderedNode) {
					renderedNode = findElement(prevValidNode(container), rendered);
				}

				parent = findElement(renderedNode, source);
				index = indexOfTextNode(temp, parent);
				// No seperatation for the first textNode of an element
				if(index === 0) {
					node = parent;
					offset = 0;
				} else {
					node = child(parent, index);
					offset = 0;
				}
			}
		} else {
			renderedNode = findElement(container.parentNode, rendered);

			if (!renderedNode) {
				renderedNode = findElement(prevValidNode(container.parentNode), rendered);
			}

			parent = findElement(renderedNode, source);
			index = indexOfTextNode(container, parent);

			if (index === -1) {
				return;
			}

			node = child(parent, index);

			offset += node.textContent.indexOf(container.textContent);
		}

		if (!node) {
			return;
		}

		return new BreakToken(
			node,
			offset,
			flexParent
		);

	}

	findBreakTokens(rendered, source, bounds = this.bounds, prevBreakToken, extract = true) {
		let allOverflowInfos = this.findOverflow(rendered, bounds, source);
		let breakTokens = [];
		if (allOverflowInfos && allOverflowInfos.length > 0) {
			for (let i = 0; i < allOverflowInfos.length; i++) {
				let overflowInfo = allOverflowInfos[i];
				let breakToken = this.findBreakToken(rendered, source, bounds, prevBreakToken, extract, overflowInfo);
				if (breakToken) {
					breakTokens.push(breakToken);
				}
			}
		}
		return breakTokens;
	}

	findBreakToken(rendered, source, bounds = this.bounds, prevBreakToken, extract = true, overflowInfo) {
		let overflow = overflowInfo.range;
		let breakToken, breakLetter;

		let overflowHooks = this.hooks.onOverflow.triggerSync(overflow, rendered, bounds, this);
		overflowHooks.forEach((newOverflow) => {
			if (typeof newOverflow != "undefined") {
				overflow = newOverflow;
			}
		});

		if (overflowInfo) {
			breakToken = this.createBreakToken(overflowInfo, rendered, source,);
			// breakToken is nullable
			let breakHooks = this.hooks.onBreakToken.triggerSync(breakToken, overflow, rendered, this);
			breakHooks.forEach((newToken) => {
				if (typeof newToken != "undefined") {
					breakToken = newToken;
				}
			});

			// Stop removal if we are in a loop
			if (breakToken && breakToken.equals(prevBreakToken)) {
				return breakToken;
			}

			if (breakToken && breakToken["node"] && breakToken["offset"] && breakToken["node"].textContent) {
				breakLetter = breakToken["node"].textContent.charAt(breakToken["offset"]);
			} else {
				breakLetter = undefined;
			}

			if (breakToken && breakToken.node && extract) {
				this.removeOverflow(overflow, breakLetter);
			}

		}
		return breakToken;
	}

	hasOverflow(element, bounds = this.bounds) {
		let constrainingElement = element && element.parentNode; // this gets the element, instead of the wrapper for the width workaround
		let {width} = element.getBoundingClientRect();
		let scrollWidth = constrainingElement ? constrainingElement.scrollWidth : 0;
		return Math.max(Math.floor(width), scrollWidth) > Math.round(bounds.width);
	}

	findOverflow(rendered, bounds = this.bounds, source) {
		if (!this.hasOverflow(rendered, bounds)) return;

		let start = Math.round(bounds.left);
		let end = Math.round(bounds.right);

		let overflowRanges = [];
		let range;

		let walker = walk(rendered.firstChild, rendered);

		// Find Start
		let next, done, node, offset, skip, breakAvoid, prev, br;
		let processingFlex;
		let hasFoundOverflow = false;
		while (!done) {
			// ....UHHH Weird issue with this walking algorithm. It will step over a text node for <p> but not for h2???!!!
			next = walker.next();
			done = next.done;
			node = next.value;
			skip = false;
			breakAvoid = false;
			prev = undefined;
			br = undefined;

			if (this.flexParent && this.flexParent.contains(node)) {
				// We are going through flexParent children
				processingFlex = true;
			} else {
				// No longer going through flexParent children, pop out
				this.flexParent =  false;
			}
			if (isFlexElement(node) && !this.flexParent) {
				this.flexParent = node;
			}

			if (node) {
				let pos = getBoundingClientRect(node);
				let left = Math.round(pos.left);
				let right = Math.floor(pos.right);

				// Because paged elements use display:grid and have columns set, using top/bottom of a node's coordinates will not
				// let you know if something is off the page. This is why the only check is left, as overflowed content goes to an 'invisible' column
				// to the right of the staged nodes.
				// If something is off the screen but no overflowRanges have been located, continue to search.
				// If overflowRanges have been located but this.flexParent is still 'on,' we will continue to search until this.flexparent disappears
				// Once something goes off the screen, we will track that in a boolean and use it in conjucntion w/ coordinates to determine if additional
				// content is off screen

				if (!this.flexParent && hasFoundOverflow && left >= end) {
					break;
				}

				if (!range && left >= end) {
					// Check if it is a float
					let isFloat = false;

					// Check if the node is inside a break-inside: avoid table cell
					const insideTableCell = parentOf(node, "TD", rendered);
					if (insideTableCell && window.getComputedStyle(insideTableCell)["break-inside"] === "avoid") {
						// breaking inside a table cell produces unexpected result, as a workaround, we forcibly avoid break inside in a cell.
						prev = insideTableCell;
					} else if (isElement(node)) {
						let styles = window.getComputedStyle(node);
						isFloat = styles.getPropertyValue("float") !== "none";
						skip = styles.getPropertyValue("break-inside") === "avoid";
						breakAvoid = node.dataset.breakBefore === "avoid" || node.dataset.previousBreakAfter === "avoid";
						prev = breakAvoid && nodeBefore(node, rendered);
						br = node.tagName === "BR" || node.tagName === "WBR";
					}

					if (prev) {
						range = document.createRange();
						range.selectNode(prev);
						break;
					}

					if (!br && !isFloat && isElement(node)) {
						range = document.createRange();
						range.selectNode(node);
						break;
					}

					if (isText(node) && node.textContent.trim().length) {
						range = document.createRange();
						range.selectNode(node);
						break;
					}
				}

				if (isText(node) &&
					node.textContent.trim().length &&
					!breakInsideAvoidParentNode(node.parentNode)) {

					let rects = getClientRects(node);
					let rect;
					left = 0;
					for (var i = 0; i != rects.length; i++) {
						rect = rects[i];
						if (rect.width > 0 && (!left || rect.left > left)) {
							left = rect.left;
						}
					}

					if (left <= end) {
						this.checkDoneRendering(node, source);
					}

					if (left >= end) {
						range = document.createRange();
						offset = this.textBreak(node, start, end);
						if (!offset) {
							range = undefined;
						} else {
							range.setStart(node, offset);
						}
						overflowRanges.push({range, flexParent: this.flexParent});
						hasFoundOverflow = true;
						// https://developer.mozilla.org/en-US/docs/Web/API/Range/startOffset
						// If the startContainer is a Node of type Text, Comment, or CDATASection, then the offset is the 
						// number of characters from the start of the startContainer to the boundary point of the Range. 
						// For other Node types, the startOffset is the number of child nodes between the start of the startContainer 
						// and the boundary point of the Range.

						// However, there is also a special 'wordWalker()' function used in Paged that goes letter by letter
						// to locate the range's exact offset (offset = this.textBreak)

						if (processingFlex) {
							// Do not break if processing flex....I guess...need to revisit for stacking contexts
						} else {
							break;
						}
					}
				}

				if (left <= end) {
					this.checkDoneRendering(node, source);
				}

				// // Skip children
				// if (skip || right <= end) {
				// 	next = nodeAfter(node, rendered);
				// 	if (next) {
				// 		walker = walk(next, rendered);
				// 	}
				// }

			}
		}

		// Find End
		if (range) {
			console.log(overflowRanges);
			range.setEndAfter(rendered.lastChild); // Sets range of last breaktoken only
			return overflowRanges;
		}

	}

	isNodeOffBottomRightCorner(node, pageBounds) {
		// A new instance of a LAYOUT class is created, per page. Each layout is initialized with the new page's element (pagedjs_page_content)
		// and bounds are calculated it with this.element.getBoundingClientRect();
		// When nodes are calculated for overflow in findOverflow, it will first try getBoundingClientRect(). But that doesn't exist on a textnode
		// and it will instead create a range around it and then call getBoundingClientRect() on the textnode
		const nodeBounds = getBoundingClientRect(node);

		const nodeRightCorner_x = nodeBounds.x + nodeBounds.width;
		const nodeRightCorner_y = nodeBounds.y + nodeBounds.height;
		const pageRightCorner_x = pageBounds.x + pageBounds.width;
		const pageRightCorner_y = pageBounds.y + pageBounds.height;

		return nodeRightCorner_x > pageRightCorner_x && nodeRightCorner_y > pageRightCorner_y;

	}

	checkDoneRendering(node, source) {
		// This gets called if the boundaries of the staged node are completely contained in a page
		// If we process a "BASIC" node (a node with no children), then we set data-done-rendering on the original in the source DOM tree
		// And when that happens, we step up to double check the parent. If ALL of the parent's children have data-done-rendering set, then
		// we set the parent as data-done-rendering too, and continue going until we hit null (no parents left) or when not all the children are done rendering

		if (node.childNodes.length === 0) {
			let original;
			if (isText(node)) {
				original = findElement(node.parentElement, source);
			} else {
				original = findElement(node, source);
			}
			if (original) {
				original.dataset.doneRendering = true;

				let originalParent = original.parentElement;

				while (originalParent && !originalParent.dataset.doneRendering) {
					let numDoneRendering = originalParent.querySelectorAll("[data-done-rendering]").length;
					let isParentDoneRendering = originalParent.childElementCount === numDoneRendering;
					originalParent.dataset.doneRendering = isParentDoneRendering;

					originalParent = originalParent.parentElement;
					if (!isParentDoneRendering) {
						break;
					}
				}
			}
		}
	}


	findEndToken(rendered, source, bounds = this.bounds) {
		if (rendered.childNodes.length === 0) {
			return;
		}

		let lastChild = rendered.lastChild;

		let lastNodeIndex;
		while (lastChild && lastChild.lastChild) {
			if (!validNode(lastChild)) {
				// Only get elements with refs
				lastChild = lastChild.previousSibling;
			} else if (!validNode(lastChild.lastChild)) {
				// Deal with invalid dom items
				lastChild = prevValidNode(lastChild.lastChild);
				break;
			} else {
				lastChild = lastChild.lastChild;
			}
		}

		if (isText(lastChild)) {

			if (lastChild.parentNode.dataset.ref) {
				lastNodeIndex = indexOf(lastChild);
				lastChild = lastChild.parentNode;
			} else {
				lastChild = lastChild.previousSibling;
			}
		}

		let original = findElement(lastChild, source);

		if (lastNodeIndex) {
			original = original.childNodes[lastNodeIndex];
		}

		let after = nodeAfter(original);

		return this.breakAt(after);
	}

	textBreak(node, start, end) {
		let wordwalker = words(node);
		let left = 0;
		let right = 0;
		let word, next, done, pos;
		let offset;
		while (!done) {
			next = wordwalker.next();
			word = next.value;
			done = next.done;

			if (!word) {
				break;
			}

			pos = getBoundingClientRect(word);

			left = Math.floor(pos.left);
			right = Math.floor(pos.right);

			if (left >= end) {
				offset = word.startOffset;
				break;
			}

			if (right > end) {
				let letterwalker = letters(word);
				let letter, nextLetter, doneLetter;

				while (!doneLetter) {
					nextLetter = letterwalker.next();
					letter = nextLetter.value;
					doneLetter = nextLetter.done;

					if (!letter) {
						break;
					}

					pos = getBoundingClientRect(letter);
					left = Math.floor(pos.left);

					if (left >= end) {
						offset = letter.startOffset;
						done = true;

						break;
					}
				}
			}

		}

		return offset;
	}

	removeOverflow(overflow, breakLetter) {
		let {startContainer} = overflow;
		let extracted = overflow.extractContents();

		this.hyphenateAtBreak(startContainer, breakLetter);

		return extracted;
	}

	hyphenateAtBreak(startContainer, breakLetter) {
		if (isText(startContainer)) {
			let startText = startContainer.textContent;
			let prevLetter = startText[startText.length - 1];

			// Add a hyphen if previous character is a letter or soft hyphen
			if (
				(breakLetter && /^\w|\u00AD$/.test(prevLetter) && /^\w|\u00AD$/.test(breakLetter)) ||
				(!breakLetter && /^\w|\u00AD$/.test(prevLetter))
			) {
				startContainer.parentNode.classList.add("pagedjs_hyphen");
				startContainer.textContent += this.settings.hyphenGlyph || "\u2011";
			}
		}
	}

	equalTokens(a, b) {
		if (!a || !b) {
			return false;
		}
		if (a["node"] && b["node"] && a["node"] !== b["node"]) {
			return false;
		}
		if (a["offset"] && b["offset"] && a["offset"] !== b["offset"]) {
			return false;
		}
		return true;
	}
}

EventEmitter(Layout.prototype);

export default Layout;
