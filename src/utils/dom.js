import * as PagedConstants from "../chunker/constants";

export function isElement(node) {
	return node && node.nodeType === 1;
}

export function isText(node) {
	return node && node.nodeType === 3;
}

export function isFlexElement(node) {
	return node && node.nodeType === 1 && window.getComputedStyle(node).getPropertyValue("display") === "flex";
}

export function *walk(start, limiter) {
	let node = start;

	while (node) {

		yield node;

		if (node.childNodes.length) {
			node = node.firstChild;
		} else if (node.nextSibling) {
			if (limiter && node === limiter) {
				node = undefined;
				break;
			}
			node = node.nextSibling;
		} else {
			while (node) {
				node = node.parentNode;
				if (limiter && node === limiter) {
					node = undefined;
					break;
				}
				if (node && node.nextSibling) {
					node = node.nextSibling;
					break;
				}

			}
		}
	}
}

export function nodeAfter(node, limiter) {
	if (limiter && node === limiter) {
		return;
	}
	let significantNode = nextSignificantNode(node);
	if (significantNode) {
		return significantNode;
	}
	if (node.parentNode) {
		while ((node = node.parentNode)) {
			if (limiter && node === limiter) {
				return;
			}
			significantNode = nextSignificantNode(node);
			if (significantNode) {
				return significantNode;
			}
		}
	}
}

export function nodeBefore(node, limiter) {
	if (limiter && node === limiter) {
		return;
	}
	let significantNode = previousSignificantNode(node);
	if (significantNode) {
		return significantNode;
	}
	if (node.parentNode) {
		while ((node = node.parentNode)) {
			if (limiter && node === limiter) {
				return;
			}
			significantNode = previousSignificantNode(node);
			if (significantNode) {
				return significantNode;
			}
		}
	}
}

export function elementAfter(node, limiter) {
	let after = nodeAfter(node, limiter);

	while (after && after.nodeType !== 1) {
		after = nodeAfter(after, limiter);
	}

	return after;
}

export function elementBefore(node, limiter) {
	let before = nodeBefore(node, limiter);

	while (before && before.nodeType !== 1) {
		before = nodeBefore(before, limiter);
	}

	return before;
}

export function displayedElementAfter(node, limiter) {
	let after = elementAfter(node, limiter);

	while (after && after.dataset.undisplayed) {
		after = elementAfter(after);
	}

	return after;
}

export function displayedElementBefore(node, limiter) {
	let before = elementBefore(node, limiter);

	while (before && before.dataset.undisplayed) {
		before = elementBefore(before);
	}

	return before;
}

export function stackChildren(currentNode, stacked) {
	let stack = stacked || [];

	stack.unshift(currentNode);

	let children = currentNode.children;
	for (var i = 0, length = children.length; i < length; i++) {
		stackChildren(children[i], stack);
	}

	return stack;
}

export function rebuildAncestors(node) {
	let parent, ancestor;
	let ancestors = [];
	let added = [];

	let fragment = document.createDocumentFragment();

	// Gather all ancestors
	let element = node;
	while(element.parentNode && element.parentNode.nodeType === 1) {
		ancestors.unshift(element.parentNode);
		element = element.parentNode;
	}

	for (var i = 0; i < ancestors.length; i++) {
		ancestor = ancestors[i];
		parent = ancestor.cloneNode(false);

		parent.setAttribute("data-split-from", parent.getAttribute("data-ref"));
		// ancestor.setAttribute("data-split-to", parent.getAttribute("data-ref"));

		if (parent.hasAttribute("id")) {
			let dataID = parent.getAttribute("id");
			parent.setAttribute("data-id", dataID);
			parent.removeAttribute("id");
		}

		// This is handled by css :not, but also tidied up here
		if (parent.hasAttribute("data-break-before")) {
			parent.removeAttribute("data-break-before");
		}

		if (parent.hasAttribute("data-previous-break-after")) {
			parent.removeAttribute("data-previous-break-after");
		}

		if (added.length) {
			let container = added[added.length-1];
			container.appendChild(parent);
		} else {
			fragment.appendChild(parent);
		}
		added.push(parent);
	}

	added = undefined;
	return fragment;
}

// Original works with a single node and rebuilds only its direct ancestors upwards
// This version iterates over multiple nodes (breakTokens) and rebuilds all siblings, skipping over text nodes
// A potential version: Based on breakToken type, call a different rebuildAncestors function
export function rebuildAncestors2(breakTokens) {
	if (!breakTokens) {
		return fragment;
	}

	let fragment = document.createDocumentFragment();
	let alreadyProcessed = new Set();

	for (let j = 0; j < breakTokens.length; j++) {
		let parent, ancestor;
		let breakToken = breakTokens[j];
		let node = breakToken.node;
		let ancestors = getAllAncestors(node);

		for (let i = 0; i < ancestors.length; i++) {
			ancestor = ancestors[i];
			if (!alreadyProcessed.has(ancestor.dataset.ref)) {
				parent = ancestor.cloneNode(false);
				setDataPropertiesOnParentBasedOnId(parent);

				if (alreadyProcessed.size > 0) {
					let container = findElement(ancestor.parentNode, fragment);
					container.appendChild(parent);
					alreadyProcessed.add(parent.dataset.ref);
				} else {
					fragment.appendChild(parent);
					alreadyProcessed.add(parent.dataset.ref);
				}
				const addedNodes = rebuildAncestorsForFlexIfAncestorIsFlexParent(breakToken, ancestor, fragment);
				alreadyProcessed = new Set([...alreadyProcessed, ...addedNodes]);
			}
		}
		
	}
	return fragment;
}

function setDataPropertiesOnParentBasedOnId(parent) {
	parent.setAttribute("data-split-from", parent.getAttribute("data-ref"));
	// ancestor.setAttribute("data-split-to", parent.getAttribute("data-ref"));

	if (parent.hasAttribute("id")) {
		let dataID = parent.getAttribute("id");
		parent.setAttribute("data-id", dataID);
		parent.removeAttribute("id");
	}

	// This is handled by css :not, but also tidied up here
	if (parent.hasAttribute("data-break-before")) {
		parent.removeAttribute("data-break-before");
	}

	if (parent.hasAttribute("data-previous-break-after")) {
		parent.removeAttribute("data-previous-break-after");
	}
}

// Returns ancestors in top down order
// eg: For node C, A -> B -> C, returns [A, B]
function getAllAncestors(node) {
	let element = node;
	let ancestors = [];
	while (element && element.parentNode && element.parentNode.nodeType === 1) {
		ancestors.unshift(element.parentNode);
		element = element.parentNode;
	}
	return ancestors;
}

// If the breakToken is flex, we have reference to the (staged) parent where flex begins
// If the passed in ancestor (node) is also the flex parent, then we build DOWNWARD,
// building ALL siblings (barring textNodes) until we hit the breakToken again
// We return nodes ids that we have appended to the fragment
function rebuildAncestorsForFlexIfAncestorIsFlexParent(breakToken, ancestor, fragment) {
	const alreadyProcessed = new Set();
	if (breakToken && breakToken.type === PagedConstants.BREAKTOKEN_TYPE_FLEX && breakToken.context.flexParent && ancestor.dataset.ref === breakToken.context.flexParent.dataset.ref) {
		var treeWalker = document.createTreeWalker(ancestor);
		let childNode = treeWalker.nextNode();
		
		while (childNode !== breakToken.node) {
			// Can potentially use data-done-rendering to avoid rerendering content that is 'already done'. data-done-rendering gets set in page append
			// Currently not using it as we render 'done' things anyway (like a col div), but the information may be used in the future
			// let doneRendering = (childNode && childNode.dataset) ? childNode.dataset.doneRendering === "true" : false;
			// Note that, at this moment, the fragment does not reflect CSS styles, probably because it is under a #document-fragment that is not connected yet

			if (!isText(childNode) && isContainer(childNode)) {
				let clone = childNode.cloneNode(false);

				// Locate the parent of the node so we don't accidentally append to the wrong element
				let clonedParentNode = findElement(childNode.parentNode, fragment);
				// Check that we have not already cloned the node we are appending
				let clonedChildNode = findElement(childNode, fragment);

				if (clonedParentNode && !clonedChildNode) {
					clonedParentNode.appendChild(clone);
					alreadyProcessed.add(childNode.dataset.ref);
				}
				
			}
			childNode = treeWalker.nextNode();
		}
	}
	return alreadyProcessed;
}

/*
export function split(bound, cutElement, breakAfter) {
		let needsRemoval = [];
		let index = indexOf(cutElement);

		if (!breakAfter && index === 0) {
			return;
		}

		if (breakAfter && index === (cutElement.parentNode.children.length - 1)) {
			return;
		}

		// Create a fragment with rebuilt ancestors
		let fragment = rebuildAncestors(cutElement);

		// Clone cut
		if (!breakAfter) {
			let clone = cutElement.cloneNode(true);
			let ref = cutElement.parentNode.getAttribute('data-ref');
			let parent = fragment.querySelector("[data-ref='" + ref + "']");
			parent.appendChild(clone);
			needsRemoval.push(cutElement);
		}

		// Remove all after cut
		let next = nodeAfter(cutElement, bound);
		while (next) {
			let clone = next.cloneNode(true);
			let ref = next.parentNode.getAttribute('data-ref');
			let parent = fragment.querySelector("[data-ref='" + ref + "']");
			parent.appendChild(clone);
			needsRemoval.push(next);
			next = nodeAfter(next, bound);
		}

		// Remove originals
		needsRemoval.forEach((node) => {
			if (node) {
				node.remove();
			}
		});

		// Insert after bounds
		bound.parentNode.insertBefore(fragment, bound.nextSibling);
		return [bound, bound.nextSibling];
}
*/

export function needsBreakBefore(node) {
	if( typeof node !== "undefined" &&
			typeof node.dataset !== "undefined" &&
			typeof node.dataset.breakBefore !== "undefined" &&
			(node.dataset.breakBefore === "always" ||
			 node.dataset.breakBefore === "page" ||
			 node.dataset.breakBefore === "left" ||
			 node.dataset.breakBefore === "right" ||
			 node.dataset.breakBefore === "recto" ||
			 node.dataset.breakBefore === "verso")
		 ) {
		return true;
	}

	return false;
}

export function needsBreakAfter(node) {
	if( typeof node !== "undefined" &&
			typeof node.dataset !== "undefined" &&
			typeof node.dataset.breakAfter !== "undefined" &&
			(node.dataset.breakAfter === "always" ||
			 node.dataset.breakAfter === "page" ||
			 node.dataset.breakAfter === "left" ||
			 node.dataset.breakAfter === "right" ||
			 node.dataset.breakAfter === "recto" ||
			 node.dataset.breakAfter === "verso")
		 ) {
		return true;
	}

	return false;
}

export function needsPreviousBreakAfter(node) {
	if( typeof node !== "undefined" &&
			typeof node.dataset !== "undefined" &&
			typeof node.dataset.previousBreakAfter !== "undefined" &&
			(node.dataset.previousBreakAfter === "always" ||
			 node.dataset.previousBreakAfter === "page" ||
			 node.dataset.previousBreakAfter === "left" ||
			 node.dataset.previousBreakAfter === "right" ||
			 node.dataset.previousBreakAfter === "recto" ||
			 node.dataset.previousBreakAfter === "verso")
		 ) {
		return true;
	}

	return false;
}

export function needsPageBreak(node, previousSignificantNode) {
	if (typeof node === "undefined" || !previousSignificantNode || isIgnorable(node)) {
		return false;
	}
	if (node.dataset && node.dataset.undisplayed) {
		return false;
	}
	const previousSignificantNodePage = previousSignificantNode.dataset ? previousSignificantNode.dataset.page : undefined;
	const currentNodePage = node.dataset ? node.dataset.page : undefined;
	return currentNodePage !== previousSignificantNodePage;
}

export function *words(node) {
	let currentText = node.nodeValue;
	let max = currentText.length;
	let currentOffset = 0;
	let currentLetter;

	let range;

	while(currentOffset < max) {
		currentLetter = currentText[currentOffset];
		if (/^[\S\u202F\u00A0]$/.test(currentLetter)) {
			if (!range) {
				range = document.createRange();
				range.setStart(node, currentOffset);
			}
		} else {
			if (range) {
				range.setEnd(node, currentOffset);
				yield range;
				range = undefined;
			}
		}

		currentOffset += 1;
	}

	if (range) {
		range.setEnd(node, currentOffset);
		yield range;
		range = undefined;
	}
}

export function *letters(wordRange) {
	let currentText = wordRange.startContainer;
	let max = currentText.length;
	let currentOffset = wordRange.startOffset;
	// let currentLetter;

	let range;

	while(currentOffset < max) {
		 // currentLetter = currentText[currentOffset];
		 range = document.createRange();
		 range.setStart(currentText, currentOffset);
		 range.setEnd(currentText, currentOffset+1);

		 yield range;

		 currentOffset += 1;
	}
}

export function isContainer(node) {
	let container;

	if (typeof node.tagName === "undefined") {
		return true;
	}

	if (node.style && node.style.display === "none") {
		return false;
	}

	switch (node.tagName) {
		// Inline
		case "A":
		case "ABBR":
		case "ACRONYM":
		case "B":
		case "BDO":
		case "BIG":
		case "BR":
		case "BUTTON":
		case "CITE":
		case "CODE":
		case "DFN":
		case "EM":
		case "I":
		case "IMG":
		case "INPUT":
		case "KBD":
		case "LABEL":
		case "MAP":
		case "OBJECT":
		case "Q":
		case "SAMP":
		case "SCRIPT":
		case "SELECT":
		case "SMALL":
		case "SPAN":
		case "STRONG":
		case "SUB":
		case "SUP":
		case "TEXTAREA":
		case "TIME":
		case "TT":
		case "VAR":
		case "P":
		case "H1":
		case "H2":
		case "H3":
		case "H4":
		case "H5":
		case "H6":
		case "FIGCAPTION":
		case "BLOCKQUOTE":
		case "PRE":
		case "LI":
		case "TR":
		case "DT":
		case "DD":
		case "VIDEO":
		case "CANVAS":
			container = false;
			break;
		default:
			container = true;
	}

	return container;
}

export function cloneNode(n, deep=false) {
	return n.cloneNode(deep);
}

export function findElement(node, doc) {
	if (node.getAttribute) {
		const ref = node.getAttribute("data-ref");
		return findRef(ref, doc);
	}
	return null;
}

export function findRef(ref, doc) {
	return doc.querySelector(`[data-ref='${ref}']`);
}

export function validNode(node) {
	if (isText(node)) {
		return true;
	}

	if (isElement(node) && node.dataset.ref) {
		return true;
	}

	return false;
}

export function prevValidNode(node) {
	while (!validNode(node)) {
		if (node.previousSibling) {
			node = node.previousSibling;
		} else {
			node = node.parentNode;
		}

		if (!node) {
			break;
		}
	}

	return node;
}

export function nextValidNode(node) {
	while (!validNode(node)) {
		if (node.nextSibling) {
			node = node.nextSibling;
		} else {
			node = node.parentNode.nextSibling;
		}

		if (!node) {
			break;
		}
	}

	return node;
}


export function indexOf(node) {
	let parent = node.parentNode;
	if (!parent) {
		return 0;
	}
	return Array.prototype.indexOf.call(parent.childNodes, node);
}

export function child(node, index) {
	return node.childNodes[index];
}

export function isVisible(node) {
	if (isElement(node) && window.getComputedStyle(node).display !== "none") {
		return true;
	} else if (isText(node) &&
			hasTextContent(node) &&
			window.getComputedStyle(node.parentNode).display !== "none") {
		return true;
	}
	return false;
}

export function hasContent(node) {
	if (isElement(node)) {
		return true;
	} else if (isText(node) &&
			node.textContent.trim().length) {
		return true;
	}
	return false;
}

export function hasTextContent(node) {
	if (isElement(node)) {
		let child;
		for (var i = 0; i < node.childNodes.length; i++) {
			child = node.childNodes[i];
			if (child && isText(child) && child.textContent.trim().length) {
				return true;
			}
		}
	} else if (isText(node) &&
			node.textContent.trim().length) {
		return true;
	}
	return false;
}

export function indexOfTextNode(node, parent) {
	if (!isText(node)) {
		return -1;
	}
	let nodeTextContent = node.textContent;
	let child;
	let index = -1;
	for (var i = 0; i < parent.childNodes.length; i++) {
		child = parent.childNodes[i];
		if (child.nodeType === 3) {
			let text = parent.childNodes[i].textContent;
			if (text.includes(nodeTextContent)) {
				index = i;
				break;
			}
		}
	}

	return index;
}


/**
 * Throughout, whitespace is defined as one of the characters
 *  "\t" TAB \u0009
 *  "\n" LF  \u000A
 *  "\r" CR  \u000D
 *  " "  SPC \u0020
 *
 * This does not use Javascript's "\s" because that includes non-breaking
 * spaces (and also some other characters).
 */

/**
 * Determine if a node should be ignored by the iterator functions.
 * taken from https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Whitespace#Whitespace_helper_functions
 *
 * @param {Node} node An object implementing the DOM1 |Node| interface.
 * @return {boolean} true if the node is:
 *  1) A |Text| node that is all whitespace
 *  2) A |Comment| node
 *  and otherwise false.
 */
export function isIgnorable(node) {
	return (node.nodeType === 8) || // A comment node
		((node.nodeType === 3) && isAllWhitespace(node)); // a text node, all whitespace
}

/**
 * Determine whether a node's text content is entirely whitespace.
 *
 * @param {Node} node  A node implementing the |CharacterData| interface (i.e., a |Text|, |Comment|, or |CDATASection| node
 * @return {boolean} true if all of the text content of |nod| is whitespace, otherwise false.
 */
export function isAllWhitespace(node) {
	return !(/[^\t\n\r ]/.test(node.textContent));
}

/**
 * Version of |previousSibling| that skips nodes that are entirely
 * whitespace or comments.  (Normally |previousSibling| is a property
 * of all DOM nodes that gives the sibling node, the node that is
 * a child of the same parent, that occurs immediately before the
 * reference node.)
 *
 * @param {ChildNode} sib  The reference node.
 * @return {Node|null} Either:
 *  1) The closest previous sibling to |sib| that is not ignorable according to |is_ignorable|, or
 *  2) null if no such node exists.
 */
export function previousSignificantNode(sib) {
	while ((sib = sib.previousSibling)) {
		if (!isIgnorable(sib)) return sib;
	}
	return null;
}

export function breakInsideAvoidParentNode(node) {
	while ((node = node.parentNode)) {
		if (node && node.dataset && node.dataset.breakInside === "avoid") {
			return node;
		}
	}
	return null;
}

/**
 * Find a parent with a given node name.
 * @param {Node} node - initial Node
 * @param {string} nodeName - node name (eg. "TD", "TABLE", "STRONG"...)
 * @param {Node} limiter - go up to the parent until there's no more parent or the current node is equals to the limiter
 * @returns {Node|undefined} - Either:
 *  1) The closest parent for a the given node name, or
 *  2) undefined if no such node exists.
 */
export function parentOf(node, nodeName, limiter) {
	if (limiter && node === limiter) {
		return;
	}
	if (node.parentNode) {
		while ((node = node.parentNode)) {
			if (limiter && node === limiter) {
				return;
			}
			if (node.nodeName === nodeName) {
				return node;
			}
		}
	}
}

/**
 * Version of |nextSibling| that skips nodes that are entirely
 * whitespace or comments.
 *
 * @param {ChildNode} sib  The reference node.
 * @return {Node|null} Either:
 *  1) The closest next sibling to |sib| that is not ignorable according to |is_ignorable|, or
 *  2) null if no such node exists.
 */
export function nextSignificantNode(sib) {
	while ((sib = sib.nextSibling)) {
		if (!isIgnorable(sib)) return sib;
	}
	return null;
}

export function filterTree(content, func, what) {
	const treeWalker = document.createTreeWalker(
		content || this.dom,
		what || NodeFilter.SHOW_ALL,
		func ? { acceptNode: func } : null,
		false
	);

	let node;
	let current;
	node = treeWalker.nextNode();
	while(node) {
		current = node;
		node = treeWalker.nextNode();
		current.parentNode.removeChild(current);
	}
}
