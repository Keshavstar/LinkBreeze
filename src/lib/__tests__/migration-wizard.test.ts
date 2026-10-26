import { describe, it, expect } from "vitest";
import { extractFromHtml } from "@/lib/migration-wizard";

describe("extractFromHtml (DOM tier)", () => {
  it("extracts non-social external links into result.links", () => {
    const html = `
      <html><body>
        <a href="https://blog.example.com/post1">My Blog Post</a>
        <a href="https://shop.example.com">Shop</a>
      </body></html>
    `;
    const result = extractFromHtml(html, new URL("https://linktr.ee/user"));
    expect(result.links.length).toBeGreaterThanOrEqual(2);
    const titles = result.links.map((l) => l.title);
    expect(titles).toContain("My Blog Post");
    expect(titles).toContain("Shop");
  });

  it("extracts social links into result.socialLinks", () => {
    const html = `
      <html><body>
        <a href="https://github.com/me">GitHub</a>
        <a href="https://twitter.com/me">Twitter</a>
      </body></html>
    `;
    const result = extractFromHtml(html, new URL("https://linktr.ee/user"));
    expect(result.socialLinks.length).toBeGreaterThanOrEqual(2);
    const urls = result.socialLinks.map((l) => l.url);
    expect(urls).toContain("https://github.com/me");
    expect(urls).toContain("https://twitter.com/me");
  });

  it("ignores javascript: and data: URLs", () => {
    const html = `
      <html><body>
        <a href="javascript:alert(1)">XSS</a>
        <a href="data:text/html,<script>alert(1)</script>">Data</a>
        <a href="https://shop.example.com">Shop</a>
      </body></html>
    `;
    const result = extractFromHtml(html, new URL("https://linktr.ee/user"));
    const allUrls = [...result.links, ...result.socialLinks].map((l) => l.url);
    expect(allUrls.some((u) => u.startsWith("javascript"))).toBe(false);
    expect(allUrls.some((u) => u.startsWith("data:"))).toBe(false);
    expect(allUrls).toContain("https://shop.example.com/");
  });

  it("skips same-origin links (internal navigation)", () => {
    const html = `
      <html><body>
        <a href="https://mysite.example.com/login">Login</a>
        <a href="https://shop.example.com">Shop</a>
      </body></html>
    `;
    const result = extractFromHtml(html, new URL("https://mysite.example.com/user"));
    const allUrls = [...result.links, ...result.socialLinks].map((l) => l.url);
    expect(allUrls).toContain("https://shop.example.com/");
    // Same-origin internal link is excluded.
    expect(allUrls).not.toContain("https://mysite.example.com/login");
  });

  it("returns empty for HTML with no external links", () => {
    const result = extractFromHtml(
      "<html><body><p>No links here</p></body></html>",
      new URL("https://linktr.ee/user"),
    );
    expect(result.links).toHaveLength(0);
    expect(result.socialLinks).toHaveLength(0);
  });

  it("deduplicates links by URL", () => {
    const html = `
      <html><body>
        <a href="https://shop.example.com">First</a>
        <a href="https://shop.example.com">Duplicate</a>
      </body></html>
    `;
    const result = extractFromHtml(html, new URL("https://linktr.ee/user"));
    const allLinks = [...result.links, ...result.socialLinks];
    const urls = allLinks.map((l) => l.url);
    expect(urls).toHaveLength(1);
  });

  it("skips links with empty titles", () => {
    const html = `<html><body><a href="https://shop.example.com"></a></body></html>`;
    const result = extractFromHtml(html, new URL("https://linktr.ee/user"));
    expect(result.links).toHaveLength(0);
  });

  it("extracts images from link thumbnails", () => {
    const html = `
      <html><body>
        <a href="https://shop.example.com"><img src="https://cdn.example.com/icon.png" />Shop</a>
      </body></html>
    `;
    const result = extractFromHtml(html, new URL("https://linktr.ee/user"));
    expect(result.links.length).toBeGreaterThanOrEqual(1);
    if (result.links[0]) {
      expect(result.links[0].imageUrl).toBe("https://cdn.example.com/icon.png");
    }
  });
});

describe("extractFromHtml (Next.js data tier)", () => {
  it("extracts from __NEXT_DATA__ script tag", () => {
    const links = [
      { title: "Blog Post", url: "https://blog.example.com/post1" },
      { title: "Store", url: "https://shop.example.com" },
    ];
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">
          ${JSON.stringify({ props: { pageProps: { links } } })}
        </script>
      </body></html>
    `;
    const result = extractFromHtml(html, new URL("https://linktr.ee/user"));
    const allLinks = [...result.links, ...result.socialLinks];
    expect(allLinks.length).toBeGreaterThanOrEqual(2);
    const titles = allLinks.map((l) => l.title);
    expect(titles).toContain("Blog Post");
    expect(titles).toContain("Store");
  });

  it("handles empty __NEXT_DATA__ gracefully", () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">{}</script></body></html>`;
    const result = extractFromHtml(html, new URL("https://linktr.ee/user"));
    expect(result.links).toHaveLength(0);
  });
});

describe("extractFromHtml (edge cases)", () => {
  it("handles empty HTML", () => {
    const result = extractFromHtml("", new URL("https://example.com"));
    expect(result.links).toHaveLength(0);
  });

  it("handles malformed HTML", () => {
    const result = extractFromHtml(
      "<div><a href='https://shop.example.com'>Link</a>",
      new URL("https://linktr.ee/user"),
    );
    expect(result.links.length).toBeGreaterThanOrEqual(0);
  });
});

// Regression: Linktree's __NEXT_DATA__ embeds a statsig feature-flag blob
// (props.pageProps.statsigInitValues.dynamicConfigs.thanksco_manual_sponsorships)
// whose .data[] are Linktree's OWN global affiliate promo links — an identical
// 26-item array on every profile. The generic recursive walk used to swallow
// that spam instead of the user's real links.
describe("extractFromHtml (Linktree statsig affiliate blob regression)", () => {
  const SPAM_DOMAINS = [
    "thanks.is", "kqzyfj.com", "linksynergy.com",
    "pxf.io", "sjv.io", "wk5q.net",
  ];
  const isSpam = (u: string) => SPAM_DOMAINS.some((d) => u.includes(d));

  const spamItems = [
    { title: "Enjoy 30 days of Hulu for FREE", url: "https://thanks.is/direct/abc123" },
    { title: "Get 60% off Sitewide", url: "https://www.kqzyfj.com/click-101093762" },
    { title: "Claim your $20 bonus", url: "https://click.linksynergy.com/fs-bin/click?id=5" },
    { title: "Sign up for Headspace Today", url: "https://headspace.pxf.io/c/5163860" },
    { title: "Get 15% off at Equip Foods", url: "https://www.equipfoods.com" },
  ];

  it("prefers real pageProps.links and never swallows the affiliate blob", () => {
    const realLinks = [
      { title: "My Real Website", url: "https://myrealwebsite.example" },
      { title: "Tour Tickets", url: "https://tickets.example/tour" },
    ];
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: { pageProps: {
            links: realLinks,
            socialLinks: [],
            statsigInitValues: { dynamicConfigs: {
              thanksco_manual_sponsorships: { data: spamItems },
            } },
          } },
        })}</script>
      </body></html>
    `;
    const result = extractFromHtml(html, new URL("https://linktr.ee/user"));
    const all = [...result.links, ...result.socialLinks];

    // Real links captured.
    const titles = all.map((l) => l.title);
    expect(titles).toContain("My Real Website");
    expect(titles).toContain("Tour Tickets");
    // No affiliate spam.
    expect(all.some((l) => isSpam(l.url))).toBe(false);
  });

  it("returns no links (not the affiliate blob) when a client-rendered account has empty SSR links", () => {
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: { pageProps: {
            links: [],
            socialLinks: [],
            statsigInitValues: { dynamicConfigs: {
              thanksco_manual_sponsorships: { data: spamItems },
            } },
          } },
        })}</script>
      </body></html>
    `;
    const result = extractFromHtml(html, new URL("https://linktr.ee/user"));
    const all = [...result.links, ...result.socialLinks];
    expect(all).toHaveLength(0);
    expect(all.some((l) => isSpam(l.url))).toBe(false);
  });

  it("still uses the generic walker for Next.js apps WITHOUT pageProps.links (Bento-style)", () => {
    // No props.pageProps.links container -> authoritative path returns null ->
    // generic walker runs, but must still skip the statsig subtree.
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: { pageProps: {
            // some OTHER nesting a non-Linktree app might use
            profile: { items: [
              { title: "Bento Item", url: "https://bento.example/item" },
            ] },
            statsigInitValues: { dynamicConfigs: {
              thanksco_manual_sponsorships: { data: spamItems },
            } },
          } },
        })}</script>
      </body></html>
    `;
    const result = extractFromHtml(html, new URL("https://bento.me/user"));
    const all = [...result.links, ...result.socialLinks];
    expect(all.map((l) => l.title)).toContain("Bento Item");
    expect(all.some((l) => isSpam(l.url))).toBe(false);
  });
});
