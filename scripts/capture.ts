// Dev-only: capture crisp marketing screenshots of each view into assets/.
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/Users/eevv/focus/coding-agent-visualizer/assets/screenshots";
const VIEWS = ["Graph", "Waterfall", "Flame", "Stats", "Timeline", "Transcript"];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1480, height: 920, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });

await page.waitForSelector(".session-item", { timeout: 15000 });
// Pick a content-rich session: most tool calls wins.
const title = await page.evaluate(() => {
  const items = [...document.querySelectorAll<HTMLElement>(".session-item")];
  const tools = (el: HTMLElement) => {
    const m = el.textContent?.match(/(\d+)\s*tools/);
    return m ? parseInt(m[1]) : 0;
  };
  // Sweet spot: rich enough to look good, small enough to stay legible.
  const best = items
    .filter(
      (el) =>
        el.textContent?.includes("Claude Code") &&
        tools(el) >= 8 &&
        tools(el) <= 20,
    )
    .sort((a, b) => tools(b) - tools(a))[0];
  best?.click();
  return best?.textContent?.slice(0, 50);
});
console.log("session:", title);
await new Promise((r) => setTimeout(r, 2000));

await Bun.$`mkdir -p ${OUT}`.quiet();
for (const v of VIEWS) {
  const handles = await page.$$('[role="tab"]');
  for (const h of handles) {
    if ((await h.evaluate((el) => el.textContent?.trim())) === v) {
      await h.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1400));
  // Zoom the graph in a couple steps so nodes + tool chips are legible.
  if (v === "Graph") {
    for (let i = 0; i < 3; i++) {
      await page.click(".react-flow__controls-zoomin").catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  const file = `${OUT}/${v.toLowerCase()}.png`;
  await page.screenshot({ path: file });
  console.log("saved", file);
}
await browser.close();
