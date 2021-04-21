/**
 * Layout
 * @class
 */
class BreakToken {

	constructor(node, offset, flexParent) {
		this.node = node;
		this.offset = offset;
		this.flexParent = flexParent;
	}

	equals(otherBreakToken) {
		if (!otherBreakToken) {
			return false;
		}
		if (this["node"] && otherBreakToken["node"] &&
			this["node"] !== otherBreakToken["node"]) {
			return false;
		}
		if (this["offset"] && otherBreakToken["offset"] &&
			this["offset"] !== otherBreakToken["offset"]) {
			return false;
		}
		return true;
	}

}

export default BreakToken;