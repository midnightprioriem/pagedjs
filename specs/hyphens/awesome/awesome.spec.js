const TIMEOUT = 10000;

describe("css is awesome", () => {
	let page;
	beforeAll(async () => {
		page = await loadPage("hyphens/awesome/awesome.html");
		return page.rendered;
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	it("should render 4 pages", async () => {
		let pages = await page.$$eval(".pagedjs_page", (r) => {
			return r.length;
		});

		expect(pages).toEqual(4);
	});

	it("page 1 should have a hyphen", async () => {
		let text = await page.$eval("[data-page-number='1']", (r) => r.textContent);

		expect(text).toContain("\u00AD");
	});

	it("page 4 should NOT have a hyphen", async () => {
		let text = await page.$eval("[data-page-number='4']", (r) => r.textContent);

		expect(text).not.toContain("\u2010");
	});


	if (!DEBUG) {
		it("should create a pdf", async () => {
			let pdf = await page.pdf(PDF_SETTINGS);

			expect(pdf).toMatchPDFSnapshot(1);
		});
	}
}
);
