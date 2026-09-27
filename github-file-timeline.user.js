// ==UserScript==
// @name         GitHub File Timeline
// @namespace    https://github.com/
// @version      0.1.0
// @description  Scrub through a file's git history directly on GitHub's code view.
// @match        https://github.com/*/*/blob/*/*
// @run-at       document-idle
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-markup.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-clike.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-css.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-python.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-bash.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-json.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-javascript.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-typescript.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-c.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-cpp.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-java.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-go.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-markdown.min.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // GitHub context
  // ---------------------------------------------------------------------------

  function extractFileContext(html) {
    const match = html.match(
      /<script type="application\/json" data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/
    );

    if (!match) {
      console.warn('[GitHub File Timeline] embeddedData script not found');
      return null;
    }

    let data;
    try {
      data = JSON.parse(match[1]);
    } catch (err) {
      console.warn('[GitHub File Timeline] failed to parse embeddedData JSON', err);
      return null;
    }

    const payload = data && data.payload;
    const route = payload && payload.codeViewBlobLayoutRoute;
    const repo = payload && payload.codeViewLayoutRoute && payload.codeViewLayoutRoute.repo;

    if (!route || !route.refInfo || !repo) {
      console.warn('[GitHub File Timeline] expected routes missing from payload');
      return null;
    }

    return {
      owner: repo.ownerLogin,
      repo: repo.name,
      path: route.path,
      ref: route.refInfo.name,
      refType: route.refInfo.refType,
      currentOid: route.refInfo.currentOid,
      language: route.blob ? route.blob.language : null,
    };
  }

  async function getFileContext() {
    try {
      const res = await fetch(window.location.href);

      if (!res.ok) {
        console.warn(
          `[GitHub File Timeline] failed to fetch current page (status ${res.status})`
        );
        return null;
      }

      return extractFileContext(await res.text());
    } catch (err) {
      console.warn('[GitHub File Timeline] failed to fetch current page', err);
      return null;
    }
  }

  function contextKey(context) {
    return `${context.owner}/${context.repo}/${context.path}@${context.currentOid}`;
  }

  // ---------------------------------------------------------------------------
  // GitHub API
  // ---------------------------------------------------------------------------

  async function fetchCommits(context) {
    const params = new URLSearchParams({
      path: context.path,
      sha: context.ref,
      per_page: '100',
    });

    const url =
      `https://api.github.com/repos/${context.owner}/${context.repo}/commits?${params}`;

    let res;

    try {
      res = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json' },
      });
    } catch (err) {
      console.warn('[GitHub File Timeline] commit history request failed', err);
      return null;
    }

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const resetHeader = res.headers.get('x-ratelimit-reset');
        const resetDate = resetHeader
          ? new Date(Number(resetHeader) * 1000)
          : null;

        console.warn(
          '[GitHub File Timeline] GitHub API rate limit hit' +
            (remaining !== null ? ` (remaining: ${remaining})` : '') +
            (resetDate
              ? `. Resets at ${resetDate.toLocaleTimeString()}.`
              : '.')
        );
      } else if (res.status === 404) {
        console.warn(
          '[GitHub File Timeline] commit history not found'
        );
      } else {
        console.warn(
          `[GitHub File Timeline] commit history request failed with status ${res.status}`
        );
      }

      return null;
    }

    const raw = await res.json();

    return raw.map((entry) => ({
      sha: entry.sha,
      date: entry.commit && entry.commit.committer && entry.commit.committer.date,
      message: entry.commit && entry.commit.message,
      author: entry.commit && entry.commit.author && entry.commit.author.name,
    }));
  }

  const contentCache = new Map();

  async function fetchFileContentAtCommit(context, sha) {
    const cacheKey = `${context.owner}/${context.repo}/${context.path}@${sha}`;

    if (contentCache.has(cacheKey)) {
      return contentCache.get(cacheKey);
    }

    const url =
      `https://raw.githubusercontent.com/${context.owner}/${context.repo}/${sha}/${context.path}`;

    let res;

    try {
      res = await fetch(url);
    } catch (err) {
      console.warn(
        '[GitHub File Timeline] failed to fetch historical file content',
        err
      );
      return null;
    }

    if (!res.ok) {
      console.warn(
        `[GitHub File Timeline] historical file content request failed with status ${res.status}`
      );
      return null;
    }

    const text = await res.text();
    contentCache.set(cacheKey, text);

    return text;
  }

  // ---------------------------------------------------------------------------
  // Timeline helpers
  // ---------------------------------------------------------------------------

  function formatCommitLabel(commit) {
    const shortSha = commit.sha ? commit.sha.slice(0, 7) : '';
    const firstLine = (commit.message || '').split('\n')[0];
    const message =
      firstLine.length > 60
        ? `${firstLine.slice(0, 57)}…`
        : firstLine;

    const date = commit.date
      ? new Date(commit.date).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '';

    return [date, message, shortSha].filter(Boolean).join(' · ');
  }

  function commitAtSliderValue(commits, value) {
    return commits[commits.length - 1 - value];
  }

  function insertPanelIntoDom(panel) {
    const commitDetails = document.querySelector(
      '[data-testid="latest-commit-details"]'
    );

    if (commitDetails && commitDetails.parentNode) {
      commitDetails.parentNode.insertBefore(
        panel,
        commitDetails.nextSibling
      );
      return true;
    }

    const codeView = document.querySelector(
      '.react-code-file-contents'
    );

    if (codeView && codeView.parentNode) {
      codeView.parentNode.insertBefore(panel, codeView);
      return true;
    }

    const header = document.querySelector(
      '.react-blob-view-header'
    );

    if (header && header.parentNode) {
      header.parentNode.insertBefore(panel, header.nextSibling);
      return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Prism / historical rendering
  // ---------------------------------------------------------------------------

  const PRISM_LANGUAGE_MAP = {
    JavaScript: 'javascript',
    TypeScript: 'typescript',
    Python: 'python',
    C: 'c',
    'C++': 'cpp',
    Java: 'java',
    Go: 'go',
    JSON: 'json',
    Shell: 'bash',
    Markdown: 'markdown',
    CSS: 'css',
    HTML: 'markup',
  };

  const HIGHLIGHT_STYLE_ID = 'ghft-highlight-theme';

  function ensureHighlightStylesInjected() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = HIGHLIGHT_STYLE_ID;

    style.textContent = `
      #ghft-historical-content .token.comment {
        color: var(--color-prettylights-syntax-comment);
      }

      #ghft-historical-content .token.keyword {
        color: var(--color-prettylights-syntax-keyword);
      }

      #ghft-historical-content .token.string {
        color: var(--color-prettylights-syntax-string);
      }

      #ghft-historical-content .token.function,
      #ghft-historical-content .token.class-name {
        color: var(--color-prettylights-syntax-entity);
      }

      #ghft-historical-content .token.number,
      #ghft-historical-content .token.boolean,
      #ghft-historical-content .token.operator {
        color: var(--color-prettylights-syntax-constant);
      }

      #ghft-historical-content .token.punctuation {
        color: var(--fgColor-muted);
      }

      #ghft-historical-content .token.macro,
      #ghft-historical-content .token.macro .token.directive {
        color: var(--color-prettylights-syntax-keyword);
      }
    `;

    document.head.appendChild(style);
  }

  function createHistoricalContentEl(text, language) {
    ensureHighlightStylesInjected();

    const wrapper = document.createElement('div');
    wrapper.id = 'ghft-historical-content';
    wrapper.style.cssText =
      'display:flex;padding:16px;background:var(--bgColor-default);' +
      'border:1px solid var(--borderColor-default);border-radius:6px;' +
      'overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
      'font-size:12px;line-height:1.45;user-select:text;';

    const lineCount = text.length === 0 ? 0 : text.split('\n').length;

    const gutter = document.createElement('div');
    gutter.style.cssText =
      'flex:0 0 auto;padding-right:16px;text-align:right;' +
      'color:var(--fgColor-muted);user-select:none;white-space:pre;';
    gutter.textContent = Array.from(
      { length: lineCount },
      (_, i) => i + 1
    ).join('\n');

    const pre = document.createElement('pre');
    pre.style.cssText =
      'position:relative;margin:0;white-space:pre;overflow:visible;' +
      'color:var(--fgColor-default);flex:1 1 auto;width:max-content;min-width:100%;';

    const code = document.createElement('code');

    const grammarName = PRISM_LANGUAGE_MAP[language];
    const grammar =
      grammarName &&
      window.Prism &&
      window.Prism.languages[grammarName];

    if (grammar) {
      code.innerHTML = window.Prism.highlight(
        text,
        grammar,
        grammarName
      );
    } else {
      code.textContent = text;
    }

    const selectionLayer = document.createElement('textarea');
    selectionLayer.id = 'ghft-selection-layer';
    selectionLayer.value = text;
    selectionLayer.readOnly = true;
    selectionLayer.spellcheck = false;
    selectionLayer.setAttribute('wrap', 'off');
    selectionLayer.setAttribute('tabindex', '0');
    selectionLayer.setAttribute(
      'aria-label',
      'Historical file content (read-only)'
    );

    selectionLayer.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;margin:0;' +
      'padding:0;border:0;outline:none;resize:none;overflow:hidden;' +
      'background:transparent;color:transparent;caret-color:transparent;' +
      'font:inherit;white-space:pre;z-index:5;pointer-events:auto;' +
      'user-select:text;';

    selectionLayer.addEventListener(
      'keydown',
      (event) => {
        const isSelectAll =
          (event.key === 'a' || event.key === 'A') &&
          (event.metaKey || event.ctrlKey);

        if (isSelectAll) {
          event.preventDefault();
          event.stopPropagation();
          selectionLayer.select();
        }
      },
      true
    );

    pre.appendChild(code);
    pre.appendChild(selectionLayer);

    wrapper.appendChild(gutter);
    wrapper.appendChild(pre);

    return wrapper;
  }

  function createFetchErrorEl(commit) {
    const wrapper = document.createElement('div');
    wrapper.id = 'ghft-historical-content';

    wrapper.style.cssText =
      'padding:16px;background:var(--bgColor-default);' +
      'border:1px solid var(--borderColor-default);' +
      'border-radius:6px;color:var(--fgColor-danger);';

    wrapper.textContent =
      `Could not load file content at ${
        commit.sha ? commit.sha.slice(0, 7) : commit.sha
      }.`;

    return wrapper;
  }

  // ---------------------------------------------------------------------------
  // Native GitHub view switching
  // ---------------------------------------------------------------------------

  let nativeCodeViewEl = null;
  let nativeParentEl = null;
  let nativeNextSiblingEl = null;
  let historicalPanelEl = null;

  function restoreNativeView() {
    if (historicalPanelEl) {
      historicalPanelEl.remove();
      historicalPanelEl = null;
    }

    if (nativeCodeViewEl) {
      nativeParentEl.insertBefore(
        nativeCodeViewEl,
        nativeNextSiblingEl
      );

      // GitHub can leave this container at width: 0px after removal.
      nativeCodeViewEl.style.width = '100%';

      nativeCodeViewEl = null;
      nativeParentEl = null;
      nativeNextSiblingEl = null;
    }

    const textarea = document.getElementById(
      'read-only-cursor-text-area'
    );

    if (textarea) {
      textarea.style.pointerEvents = 'auto';
    }
  }

  function showInPlaceOfNativeView(buildContentEl) {
    if (!nativeCodeViewEl) {
      const el = document.querySelector(
        '.react-code-file-contents'
      );

      if (!el || !el.parentNode) {
        console.warn(
          '[GitHub File Timeline] could not find the native code view'
        );
        return false;
      }

      nativeCodeViewEl = el;
      nativeParentEl = el.parentNode;
      nativeNextSiblingEl = el.nextSibling;

      nativeCodeViewEl.remove();
    }

    const textarea = document.getElementById(
      'read-only-cursor-text-area'
    );

    if (textarea) {
      textarea.style.pointerEvents = 'none';
    }

    if (historicalPanelEl) {
      historicalPanelEl.remove();
      historicalPanelEl = null;
    }

    const contentEl = buildContentEl();

    nativeParentEl.insertBefore(
      contentEl,
      nativeNextSiblingEl
    );

    historicalPanelEl = contentEl;

    return true;
  }

  // ---------------------------------------------------------------------------
  // Historical content fetching
  // ---------------------------------------------------------------------------

  let contentRequestSeq = 0;
  let sliderDebounceTimer = null;

  function wireContentFetching(
    context,
    generation,
    commits,
    slider
  ) {
    const newestSha = commits[0].sha;

    async function settle() {
      if (generation !== currentGeneration) {
        return;
      }

      const commit = commitAtSliderValue(
        commits,
        Number(slider.value)
      );

      if (commit.sha === newestSha) {
        // Invalidate any historical request that is still in flight.
        contentRequestSeq++;
        restoreNativeView();
        return;
      }

      const requestId = ++contentRequestSeq;

      const text = await fetchFileContentAtCommit(
        context,
        commit.sha
      );

      if (
        generation !== currentGeneration ||
        requestId !== contentRequestSeq
      ) {
        return;
      }

      if (text === null) {
        showInPlaceOfNativeView(
          () => createFetchErrorEl(commit)
        );
      } else {
        showInPlaceOfNativeView(
          () => createHistoricalContentEl(
            text,
            context.language
          )
        );
      }
    }

    slider.addEventListener('input', () => {
      clearTimeout(sliderDebounceTimer);

      sliderDebounceTimer = setTimeout(
        settle,
        250
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Timeline UI
  // ---------------------------------------------------------------------------

  function createPanel(commits) {
    const panel = document.createElement('div');
    panel.id = 'ghft-panel';

    panel.style.cssText =
      'display:flex;align-items:center;gap:12px;padding:8px 16px;' +
      'background:var(--bgColor-muted);border:1px solid var(--borderColor-default);' +
      'border-radius:6px;margin-bottom:8px;font-size:12px;' +
      'color:var(--fgColor-default);';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(commits.length - 1);
    slider.step = '1';
    slider.value = String(commits.length - 1);

    slider.style.cssText =
      'flex:1 1 auto;min-width:0;accent-color:var(--fgColor-accent);';

    slider.setAttribute(
      'aria-label',
      'File history timeline'
    );

    const label = document.createElement('span');
    label.id = 'ghft-label';

    label.style.cssText =
      'flex:0 0 260px;width:260px;color:var(--fgColor-muted);' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    label.setAttribute('aria-live', 'polite');

    label.textContent = formatCommitLabel(
      commitAtSliderValue(
        commits,
        commits.length - 1
      )
    );

    slider.addEventListener('input', () => {
      const commit = commitAtSliderValue(
        commits,
        Number(slider.value)
      );

      label.textContent = formatCommitLabel(commit);
    });

    panel.appendChild(slider);
    panel.appendChild(label);

    return { panel, slider };
  }

  let panelEl = null;

  function teardown() {
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }

    clearTimeout(sliderDebounceTimer);
    sliderDebounceTimer = null;

    contentRequestSeq++;
    restoreNativeView();
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  async function init(context, generation) {
    const commits = await fetchCommits(context);

    if (generation !== currentGeneration) {
      return false;
    }

    if (!commits || commits.length === 0) {
      return true;
    }

    const { panel, slider } = createPanel(commits);

    if (!insertPanelIntoDom(panel)) {
      console.warn(
        '[GitHub File Timeline] could not find a place to insert the timeline UI'
      );
      return false;
    }

    panelEl = panel;
    wireContentFetching(
      context,
      generation,
      commits,
      slider
    );

    return true;
  }

  // ---------------------------------------------------------------------------
  // GitHub navigation / lifecycle
  // ---------------------------------------------------------------------------

  let lastContextKey = null;
  let currentGeneration = 0;
  let syncInFlight = false;
  let syncPending = false;

  async function sync() {
    if (syncInFlight) {
      syncPending = true;
      return;
    }

    syncInFlight = true;

    try {
      const context = await getFileContext();

      if (!context) {
        return;
      }

      const key = contextKey(context);

      if (key === lastContextKey) {
        return;
      }

      currentGeneration++;
      const generation = currentGeneration;

      teardown();

      const initialized = await init(
        context,
        generation
      );

      if (
        initialized &&
        generation === currentGeneration
      ) {
        lastContextKey = key;
      }
    } finally {
      syncInFlight = false;

      if (syncPending) {
        syncPending = false;
        sync();
      }
    }
  }

  document.addEventListener(
    'turbo:load',
    sync
  );

  const contentFrame = document.getElementById(
    'repo-content-turbo-frame'
  );

  if (contentFrame) {
    const observer = new MutationObserver(() => {
      sync();
    });

    observer.observe(
      contentFrame,
      {
        childList: true,
        subtree: true,
      }
    );
  }

  sync();
})();