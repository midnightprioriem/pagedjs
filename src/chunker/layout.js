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

		this.maxChars = 1000000000000000000000000;
		// Temporarily comment out...by setting it HUGE then we basically process the whole page for overflows,
		// as opposed to sending DOM elements with max of 1500 text length for overflow checking
		// this.maxChars = this.settings.maxChars || MAX_CHARS_PER_BREAK;
		this.forceRenderBreak = false;
	}

	async renderTo(wrapper, source, breakTokens, bounds = this.bounds) {

		let start = this.getStart(source, breakTokens[0]);
		let walker = walk(start, source);

		let node;
		let prevNode;
		let done;
		let next;

		let hasRenderedContent = false;
		// let newBreakToken;
		let newBreakTokens;

		let length = 0;

		// Uhh is it okay to assign this to the first...
		let prevBreakToken = breakTokens[0] || new BreakToken(start);

		// Summary of what goes on
		// We get a breaktoken. We rebuild bottom up that breaktoken's ancestors
		// (ADDED) During rebuilding ancestors, we check the breaktoken's flexparent, and rebuild downward for siblings until we find the breaktoken again
		// Then a bunch of potential break conditions
		// 	1 - dataset breakbefore is set (triggers shouldBreak)
		// 	2 - forceRenderBreak is true (??? don't know why)
		// 	3 - character length exceeds max (I have turned this off)
		// 	4 - the nodewalker finds null because we've walked to the end (this is what's happening on my local. This seems terrible for performance for Salesforce)
		// In every loop, we add a new node - and if that node is a text breaktoken, we cut off the text based on offset


		
		this.rebuildAllAncestorsForBreakTokens(breakTokens, wrapper, start);
		
		while (!done && !newBreakTokens) {

			
			next = walker.next();
			prevNode = node;
			node = next.value;
			done = next.done;
			let original = isElement(node) ? findElement(node, source) : null;
			if (!original || (original && (isText(node) || (isElement(original) && !original.dataset.doneRendering)))) {
			// if (true) {
			
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
	
				// Only check x characters
	
				// ???? Here it is tracking total # of characters for a section, and once those characters are
				// over 1500 only THEN does it trigger the 'look for overflow' logic?
				// But like....weird...And causes issue where the stuff it sends to check for overflows is missing, say,
				// the third column
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
			
			// if (!node) {
			// 	this.hooks && this.hooks.layout.trigger(wrapper, this);

			// 	let imgs = wrapper.querySelectorAll("img");
			// 	if (imgs.length) {
			// 		await this.waitForImages(imgs);
			// 	}

			// 	newBreakTokens = this.findBreakTokens(wrapper, source, bounds, prevBreakToken);

			// 	for (let i = 0; i < newBreakTokens.length; i++) {
			// 		let newBreakToken = newBreakTokens[i];
			// 		if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
			// 			console.warn("Unable to layout item: ", prevNode);
			// 			return undefined;
			// 		}
			// 	}
			// 	return newBreakTokens;
			// }
			// this.hooks && this.hooks.layoutNode.trigger(node);

			// // Check if the rendered element has a break set
			// if (hasRenderedContent && this.shouldBreak(node)) {
			// 	this.hooks && this.hooks.layout.trigger(wrapper, this);

			// 	let imgs = wrapper.querySelectorAll("img");
			// 	if (imgs.length) {
			// 		await this.waitForImages(imgs);
			// 	}

			// 	newBreakTokens = this.findBreakTokens(wrapper, source, bounds, prevBreakToken);

			// 	if (!newBreakTokens || newBreakTokens.length === 0) {
			// 		let newBreakToken = this.breakAt(node);
			// 		newBreakTokens.push(newBreakToken);
			// 	}


			// 	for (let i = 0; i < newBreakTokens.length; i++) {
			// 		let newBreakToken = newBreakTokens[i];
			// 		if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
			// 			console.warn("Unable to layout item: ", prevNode);
			// 			return undefined;
			// 		}
			// 	}

			// 	length = 0;

			// 	break;
			// }

			// // Should the Node be a shallow or deep clone
			// let shallow = isContainer(node);
			// let rendered = this.append(node, wrapper, breakTokens, shallow);

			// length += rendered.textContent.length;

			// // Check if layout has content yet
			// if (!hasRenderedContent) {
			// 	hasRenderedContent = hasContent(node);
			// }

			// // Skip to the next node if a deep clone was rendered
			// if (!shallow) {
			// 	walker = walk(nodeAfter(node, source), source);
			// }

			// if (this.forceRenderBreak) {
			// 	this.hooks && this.hooks.layout.trigger(wrapper, this);

			// 	newBreakTokens = this.findBreakTokens(wrapper, source, bounds, prevBreakToken);

			// 	if (!newBreakTokens || newBreakTokens.length === 0) {
			// 		let newBreakToken = this.breakAt(node);
			// 		newBreakTokens.push(newBreakToken);
			// 	}

			// 	length = 0;
			// 	this.forceRenderBreak = false;

			// 	break;
			// }

			// // Only check x characters

			// // ???? Here it is tracking total # of characters for a section, and once those characters are
			// // over 1500 only THEN does it trigger the 'look for overflow' logic?
			// // But like....weird...And causes issue where the stuff it sends to check for overflows is missing, say,
			// // the third column
			// if (length >= this.maxChars) {

			// 	this.hooks && this.hooks.layout.trigger(wrapper, this);

			// 	let imgs = wrapper.querySelectorAll("img");
			// 	if (imgs.length) {
			// 		await this.waitForImages(imgs);
			// 	}

			// 	newBreakTokens = this.findBreakTokens(wrapper, source, bounds, prevBreakToken);

			// 	for (let i = 0; i < newBreakTokens.length; i++) {
			// 		let newBreakToken = newBreakTokens[i];
			// 		if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
			// 			console.warn("Unable to layout item: ", prevNode);
			// 			return undefined;
			// 		}
			// 	}

			// 	if (newBreakTokens && newBreakTokens.length > 0) {
			// 		length = 0;
			// 	}
			// }

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

		if (breakTokens && !breakTokens[0]) {
			// dest = wrapper

			// If we hit the breakToken's parent (do data-id comparison)
			// then go into small loop where we build DOWNWARDS until we hit the
			// breaktoken...

			let clone = findElement(node, dest);
			// what if it is already staged

			if (!clone) {
				clone = cloneNode(node, !shallow);
		
				if (node.parentNode && isElement(node.parentNode)) {
					let parent = findElement(node.parentNode, dest);
					// Rebuild chain
					if (parent) {
						parent.appendChild(clone);
					} else if (rebuild) {
						// scratch that this rebuild ancestors thing is the only thing responsible
						// for building upwards
						// let fragment = rebuildAncestors(node, breakToken);
						let fragment = rebuildAncestors2(breakTokens);
		
						for (let j = 0; j < breakTokens.length; j++) {
							let breakToken = breakTokens[j];
							let clonedNode = cloneNode(breakToken.node, !shallow);
							parent = findElement(breakToken.node.parentNode, fragment);
							if (!parent) {
								dest.appendChild(clonedNode);
							} else if (breakToken && isText(breakToken.node) && breakToken.offset > 0) {
								clonedNode.textContent = clonedNode.textContent.substring(breakToken.offset);
								parent.appendChild(clonedNode);
							} else {
								parent.appendChild(clonedNode);
							}
						}
						dest.appendChild(fragment);
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
		} 
		// else if (breakTokens && breakTokens.length > 0) {
		// 	let fragment = rebuildAncestors2(breakTokens);
		
		// 	for (let j = 0; j < breakTokens.length; j++) {
		// 		let breakToken = breakTokens[j];
		// 		let clonedNode = cloneNode(breakToken.node, !shallow);
		// 		let parent = findElement(breakToken.node.parentNode, fragment);
		// 		if (!parent) {
		// 			dest.appendChild(clonedNode);
		// 		} else if (breakToken && isText(breakToken.node) && breakToken.offset > 0) {
		// 			clonedNode.textContent = clonedNode.textContent.substring(breakToken.offset);
		// 			parent.appendChild(clonedNode);
		// 		} else {
		// 			parent.appendChild(clonedNode);
		// 		}
		// 	}
		// 	dest.appendChild(fragment);
		// 	return null;
		// }

		// // dest = wrapper

		// // If we hit the breakToken's parent (do data-id comparison)
		// // then go into small loop where we build DOWNWARDS until we hit the
		// // breaktoken...

		// let clone = findElement(node, dest);
		// // what if it is already staged

		// if (!clone) {
		// 	clone = cloneNode(node, !shallow);
	
		// 	if (node.parentNode && isElement(node.parentNode)) {
		// 		let parent = findElement(node.parentNode, dest);
		// 		// Rebuild chain
		// 		if (parent) {
		// 			parent.appendChild(clone);
		// 		} else if (rebuild) {
		// 			// scratch that this rebuild ancestors thing is the only thing responsible
		// 			// for building upwards
		// 			// let fragment = rebuildAncestors(node, breakToken);
		// 			let fragment = rebuildAncestors2(breakTokens);
	
		// 			for (let j = 0; j < breakTokens.length; j++) {
		// 				let breakToken = breakTokens[j];
		// 				let clonedNode = cloneNode(breakToken.node, !shallow);
		// 				parent = findElement(breakToken.node.parentNode, fragment);
		// 				if (!parent) {
		// 					dest.appendChild(clonedNode);
		// 				} else if (breakToken && isText(breakToken.node) && breakToken.offset > 0) {
		// 					clonedNode.textContent = clonedNode.textContent.substring(breakToken.offset);
		// 					parent.appendChild(clonedNode);
		// 				} else {
		// 					parent.appendChild(clonedNode);
		// 				}
		// 			}
		// 			dest.appendChild(fragment);
		// 		} else {
		// 			dest.appendChild(clone);
		// 		}
	
	
		// 	} else {
		// 		dest.appendChild(clone);
		// 	}
	
		// 	let nodeHooks = this.hooks.renderNode.triggerSync(clone, node, this);
		// 	nodeHooks.forEach((newNode) => {
		// 		if (typeof newNode != "undefined") {
		// 			clone = newNode;
		// 		}
		// 	});
		// }
		// return clone;
	}

	rebuildAllAncestorsForBreakTokens(breakTokens, dest, node, shallow = true) {
		if (!breakTokens) {
			return;
		}
		let nodeToUse;
		if (breakTokens && !breakTokens[0]) {
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
		// let allOverflowInfos = this.findOverflow(rendered, bounds);
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
		while (!done) {
			// ....UHHH ISSUE with this walking algorithm. It will step over a text node for <p> but not for h2???
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
				// No longer going through flexParent children
				this.flexParent =  false;
			}
			if (isFlexElement(node) && !this.flexParent) {
				this.flexParent = node;
			}

			if (node) {
				let pos = getBoundingClientRect(node);
				let left = Math.round(pos.left);
				let right = Math.floor(pos.right);

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

						if (processingFlex) {
							// Do not break if processing flex....I guess...
						} else {
							break;
						}
					}
				}

				if (left <= end) {
					this.checkDoneRendering(node, source);
				}

				// Skip children
				if (skip || right <= end) {
					next = nodeAfter(node, rendered);
					if (next) {
						walker = walk(next, rendered);
					}

				}

			}
		}

		// Find End
		if (range) {
			console.log(overflowRanges);
			range.setEndAfter(rendered.lastChild);
			// return range;
			return overflowRanges;
			// return overflowRanges[0];
		}

	}

	checkDoneRendering(node, source) {
		// If we are BASIC (no children)
		// We can set data-is-done-rendering on the original
		// And then do a check for the container
		// if we are then we bubble back up

		if (node.childNodes.length === 0 || node.tagName === "H2") { // Terrible hack, actually need to fix the walker to be consistent
			let original;
			if (isText(node)) {
				original = findElement(node.parentElement, source);
			} else {
				original = findElement(node, source);
			}
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
