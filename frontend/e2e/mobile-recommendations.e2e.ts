import {expect, test} from "@playwright/test";

const tracks = [
  {title: "Night Cruising", artist: "Fishmans"},
  {title: "Midnight Pretenders", artist: "Tomoko Aran"},
  {title: "Aruarian Dance", artist: "Nujabes"},
];

test("keeps recommendation rows visible and within mobile boundaries", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("给回家路上的柔和夜色")).toBeVisible();

  const list = page.getByRole("list", {name: "为你选的歌"});
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(tracks.length);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  for (const [index, track] of tracks.entries()) {
    const row = rows.nth(index);
    const title = row.getByText(track.title, {exact: true});
    const artist = row.getByText(track.artist, {exact: true});
    const playButton = row.getByRole("button", {
      name: `播放 ${track.title}`,
    });

    await expect(title).toHaveText(track.title);
    await expect(artist).toHaveText(track.artist);
    await expect(playButton).toBeVisible();

    const [rowRect, titleRect, artistRect, buttonRect] = await Promise.all(
      [row, title, artist, playButton].map((locator) =>
        locator.evaluate((element) => {
          const {x, y, width, height, right, bottom} =
            element.getBoundingClientRect();
          return {x, y, width, height, right, bottom};
        }),
      ),
    );

    expect(titleRect.width).toBeGreaterThan(0);
    expect(artistRect.width).toBeGreaterThan(0);

    expect(buttonRect.x).toBeGreaterThanOrEqual(rowRect.x);
    expect(buttonRect.y).toBeGreaterThanOrEqual(rowRect.y);
    expect(buttonRect.right).toBeLessThanOrEqual(rowRect.right);
    expect(buttonRect.bottom).toBeLessThanOrEqual(rowRect.bottom);

    expect(buttonRect.x).toBeGreaterThanOrEqual(0);
    expect(buttonRect.y).toBeGreaterThanOrEqual(0);
    expect(buttonRect.right).toBeLessThanOrEqual(viewport!.width);
    expect(buttonRect.bottom).toBeLessThanOrEqual(viewport!.height);
  }

  const documentWidths = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(documentWidths.scrollWidth).toBeLessThanOrEqual(
    documentWidths.clientWidth,
  );
});
