const TIMEOUT = 10000;

describe("long section break before", () => {
	let page;
	beforeAll(async () => {
		page = await loadPage("breaks/break-inside/break-inside-avoid/long-section-break-before.html");
		return page.rendered;
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	it("should ignore comply with break-before:page (precedence over break-inside:avoid)", async () => {
		let pages = await page.$$eval(".pagedjs_page", (r) => r.length);
		expect(pages).toBe(3);
	});

	if (!DEBUG) {
		it("should create a pdf", async () => {
			let pdf = await page.pdf(PDF_SETTINGS);
			expect(pdf).toMatchPDFSnapshot(1);
			expect(pdf).toMatchPDFSnapshot(2);
			expect(pdf).toMatchPDFSnapshot(3);
		});
	}
});
