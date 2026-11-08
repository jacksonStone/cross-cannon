// Run through the Codex browser's documented tab API. It exercises real Remix
// actions and history; callers provide an open, hydrated Scripture reader tab.
export async function checkSearchHistory(tab, { query = 'Hope after death', reference = 'Job 17:15-16' } = {}) {
  const p = tab.playwright;
  await p.locator('.reader-passage-text').first().waitFor({ state: 'attached' });
  if (await p.locator('.search-modal').count()) {
    await p.locator('.search-modal-header').getByRole('button', { name: 'Close', exact: true }).click();
  }
  if (await p.getByRole('button', { name: 'Open reader tools', exact: true }).count()) {
    await p.getByRole('button', { name: 'Open reader tools', exact: true }).click();
  }
  await p.getByRole('button', { name: 'Search', exact: true }).click();
  await p.locator('#question').fill(query);
  await p.getByRole('button', { name: 'Search Bible', exact: true }).click();
  await p.waitForLoadState({ state: 'networkidle' });
  await p.locator('.search-band[aria-busy="false"]').waitFor({ state: 'attached' });
  await p.getByText(reference, { exact: true }).first().waitFor({ state: 'attached' });
  const before = await p.locator('.search-modal .result-meta').allTextContents();
  if (!before.length) throw new Error('Search returned no results');
  await p.locator('.search-modal .scripture-result-button').first().click();
  const scrollBefore = await p.locator('.search-modal-body').evaluate(e => e.scrollTop);
  await p.getByRole('link', { name: 'Jump to', exact: true }).first().click();
  await p.waitForLoadState({ state: 'networkidle' });
  await p.locator('.search-modal').waitFor({ state: 'hidden' });
  const destination = await tab.url();
  if (!destination.includes('/reader/')) throw new Error('Context action did not navigate to the reader');
  await tab.back();
  await p.waitForLoadState({ state: 'networkidle' });
  await p.locator('.search-modal').waitFor({ state: 'visible' });
  const after = await p.locator('.search-modal .result-meta').allTextContents();
  const restoredQuery = await p.locator('#question').evaluate(e => e.value);
  const scrollAfter = await p.locator('.search-modal-body').evaluate(e => e.scrollTop);
  if (restoredQuery !== query) throw new Error(`Lost query: ${JSON.stringify(restoredQuery)}`);
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('Back changed or lost the ranked results');
  // Activating a context link can bring its action row into view. Keep these
  // measurements as evidence; the restored response/query are the invariant.
  await tab.forward();
  await p.waitForLoadState({ state: 'networkidle' });
  await p.locator('.search-modal').waitFor({ state: 'hidden' });
  await tab.back();
  await p.waitForLoadState({ state: 'networkidle' });
  await p.locator('.search-modal').waitFor({ state: 'visible' });
  if (await p.locator('#question').evaluate(e => e.value) !== query) throw new Error('Second Back lost the query');
  return { query, resultCount: after.length, destination, scrollBefore, scrollAfter, forwardAndBack: 'pass' };
}
