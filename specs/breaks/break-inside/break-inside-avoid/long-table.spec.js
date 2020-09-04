const TIMEOUT = 10000;

describe("long table", () => {
	let page;
	beforeAll(async () => {
		page = await loadPage("breaks/break-inside/break-inside-avoid/long-table.html");
		return page.rendered;
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	// it should ignore the rule "break-inside: avoid" because the table does not fit on the next page
	it("should ignore break-inside:avoid when the element (table) does not fit on a page", async () => {
		let pages = await page.$$eval(".pagedjs_page", (r) => r.length);
		expect(pages).toBe(2);
	});

	if (!DEBUG) {
		it("should create a pdf", async () => {
			let pdf = await page.pdf(PDF_SETTINGS);
			expect(pdf).toMatchPDFSnapshot(1);
			expect(pdf).toMatchPDFSnapshot(2);
		});
	}
});
