import * as PagedConstants from "./constants";

/**
 * Layout
 * @class
 */
class BreakToken {

	constructor(node, offset, context = {type: PagedConstants.BREAKTOKEN_TYPE_NONE}) {
		this.node = node;
		this.offset = offset;
		this.context = context;
		this.type = context.type;
	}

	getType() {
		return this.type;
	}

	equals(otherBreakToken) {
		if (!otherBreakToken) {
			return false;
		}
		if (this.getType() !== otherBreakToken.getType()) {
			return false;
		}
		if (this["node"] !== otherBreakToken["node"]) {
			return false;
		}
		if (this["offset"] !== otherBreakToken["offset"]) {
			return false;
		}
		return true;
	}

}

export default BreakToken;