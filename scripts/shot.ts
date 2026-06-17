// Dev-only smoke test: drive the app in headless Chrome, switch every tab,
// screenshot each, and report any console / page errors. Not shipped.
import puppeteer from "puppeteer-core";

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/tmp/cav-shots";
const TABS = ["Graph", "Waterfall", "Flame", "Timeline", "Files", "Stats", "Transcript"];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--window-size=1600,1000"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto("http://localhost:19876/", { waitUntil: "networkidle2", timeout: 30000 });

// Pick the session for THIS project (its title contains the cwd basename).
await page.waitForSelector(".session-item", { timeout: 15000 });
const picked = await page.evaluate(() => {
  const items = [...document.querySelectorAll<HTMLElement>(".session-item")];
  const hit =
    items.find((el) => el.textContent?.includes("coding-agent-visualizer")) ??
    items[0];
  hit?.click();
  return hit?.textContent?.slice(0, 60) ?? null;
});
console.log("picked session:", picked);

await new Promise((r) => setTimeout(r, 1500)); // let session fetch + render

await Bun.$`mkdir -p ${OUT}`.quiet();

for (const tab of TABS) {
  const handles = await page.$$('[role="tab"]');
  let clicked = false;
  for (const h of handles) {
    const text = await h.evaluate((el) => el.textContent?.trim());
    if (text === tab) {
      await h.click(); // real mouse click → focus + activate (Radix automatic mode)
      clicked = true;
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
  const file = `${OUT}/${tab.toLowerCase()}.png`;
  await page.screenshot({ path: file });
  console.log(`${clicked ? "✓" : "✗ (tab not found)"} ${tab} -> ${file}`);
}

await browser.close();

if (errors.length) {
  console.log(`\n❌ ${errors.length} runtime error(s):`);
  for (const e of [...new Set(errors)]) console.log("  " + e);
  process.exit(1);
} else {
  console.log("\n✅ no runtime errors across all tabs");
}
