/* REST Quest - client side.
   Vanilla JS. It helps the player build a real HTTP request, sends it with AJAX and
   shows what came back. It never decides whether an answer is right - that verdict
   always comes from the server. */

let game = window.__GAME__;
let selectedMethod = null;

const levelPanel = document.getElementById('level-panel');
const docsPanel = document.getElementById('docs-panel');
const stepper = document.getElementById('stepper');
const progressChip = document.getElementById('progress-chip');
const scoreChip = document.getElementById('score-chip');

const byId = id => document.getElementById(id);

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function badgeFor(status) {
    if (status >= 200 && status < 300) return 'badge-ok';
    if (status >= 300 && status < 400) return 'badge-info';
    return 'badge-err';
}

/* ---------------------------------------------------------------- query parameter rows */

function makeParamRow(name = '', value = '') {
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `
        <input type="text" class="param-name" placeholder="name" spellcheck="false">
        <span class="param-eq">=</span>
        <input type="text" class="param-value" placeholder="value" spellcheck="false">
        <button type="button" class="btn btn-mini btn-del" title="Remove this parameter">&minus;</button>`;
    row.querySelector('.param-name').value = name;
    row.querySelector('.param-value').value = value;
    return row;
}

function buildQueryString() {
    const pairs = [];
    for (const row of document.querySelectorAll('#params .param-row')) {
        const name = row.querySelector('.param-name').value.trim();
        const value = row.querySelector('.param-value').value.trim();
        if (name) pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
    }
    return pairs.join('&');
}

function currentUrl() {
    const route = byId('route') ? byId('route').value.trim() : '';
    const query = byId('params') ? buildQueryString() : '';
    return route + (query ? `?${query}` : '');
}

function refreshPreview() {
    const preview = byId('url-preview');
    if (!preview) return;
    preview.textContent = `${selectedMethod || 'METHOD'} ${currentUrl() || '/api/...'}`;
}

/* ---------------------------------------------------------------- the response panel */

function renderResponse(result) {
    const box = byId('response');
    if (!box) return;

    if (result.local) {
        box.innerHTML = `
            <div class="response-card">
                <p class="response-line">
                    <span class="badge badge-err">not sent</span>
                    <code>${escapeHtml(`${result.method} ${result.url}`)}</code>
                </p>
                <p class="verdict verdict-local">${escapeHtml(result.hint)}</p>
            </div>`;
        return;
    }

    const verdictText = result.request_ok
        ? 'This is the request the level asked for. Now read the response and answer below.'
        : (result.hint || 'That is not the request this level is looking for.');

    let bodyHtml;
    if (result.status === 204) {
        bodyHtml = `<p class="no-body">No response body - that is exactly what
            <strong>204 No Content</strong> means: the request succeeded and there was
            deliberately nothing to send back.</p>`;
    } else if (result.body === null || result.body === '') {
        bodyHtml = '<p class="no-body">The response had an empty body.</p>';
    } else {
        const text = typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2);
        bodyHtml = `<pre class="json">${escapeHtml(text)}</pre>`;
    }

    const notice = result.notice
        ? `<p class="notice">Server note: ${escapeHtml(result.notice)}</p>`
        : '';

    let headersHtml = '';
    if (result.headers && result.headers.length) {
        const rows = result.headers.map(([name, value]) => `
            <tr>
                <td><code>${escapeHtml(name)}</code></td>
                <td>${escapeHtml(value)}</td>
            </tr>`).join('');
        headersHtml = `
            <details class="headers">
                <summary>Response headers</summary>
                <table class="header-table"><tbody>${rows}</tbody></table>
            </details>`;
    }

    const statusLabel = result.status + (result.status_text ? ` ${result.status_text}` : '');

    box.innerHTML = `
        <div class="response-card">
            <p class="response-line">
                <span class="badge ${badgeFor(result.status)}">${escapeHtml(statusLabel)}</span>
                <code>${escapeHtml(`${result.method} ${result.url}`)}</code>
            </p>
            <p class="verdict ${result.request_ok ? 'verdict-ok' : 'verdict-no'}">${escapeHtml(verdictText)}</p>
            ${notice}${bodyHtml}${headersHtml}
        </div>`;
}

function showLocalProblem(message) {
    renderResponse({
        local: true,
        method: selectedMethod || 'METHOD',
        url: currentUrl() || '/api/...',
        hint: message,
    });
}

/* ---------------------------------------------------------------- sending the request */

async function sendRequest() {
    if (game.read_only) return;

    if (!selectedMethod) return showLocalProblem('Pick an HTTP method first.');

    const route = byId('route').value.trim();
    if (!route) return showLocalProblem('Type the route you want to call.');
    if (!route.startsWith('/')) {
        return showLocalProblem('A route has to start with a slash, like /api/items');
    }
    if (route.includes('?')) {
        return showLocalProblem('Leave the ? out of the route: the query string is built from the parameter rows.');
    }

    const options = {
        method: selectedMethod,
        headers: { 'X-Game-Level': String(game.level.id) },
    };

    const bodyField = byId('body');
    const raw = bodyField ? bodyField.value.trim() : '';
    if (raw) {
        if (selectedMethod === 'GET') {
            return showLocalProblem('A GET request does not carry a body. Clear it, or pick another method.');
        }
        try {
            JSON.parse(raw);
        } catch (err) {
            return showLocalProblem(`The request body is not valid JSON: ${err.message}`);
        }
        options.headers['Content-Type'] = 'application/json';
        options.body = raw;
    }

    const url = currentUrl();
    const runButton = byId('run');
    runButton.disabled = true;
    runButton.classList.add('is-busy');

    try {
        const response = await fetch(url, options);
        const text = await response.text();

        let body = null;
        if (text) {
            try { body = JSON.parse(text); } catch { body = text; }
        }

        const headers = [...response.headers].sort((a, b) => (a[0] < b[0] ? -1 : 1));
        const hint = response.headers.get('X-Game-Hint');
        const requestOk = response.headers.get('X-Game-Request-Ok') === '1';

        setLevelScore(response.headers.get('X-Game-Level-Score'), false);

        renderResponse({
            method: options.method,
            url,
            status: response.status,
            status_text: response.statusText || '',
            request_ok: requestOk,
            hint: hint ? decodeURIComponent(hint) : null,
            notice: response.headers.get('X-Notice'),
            body,
            headers,
        });

        if (requestOk) {
            game.record.request_ok = true;
            byId('answer')?.focus();
        }
    } catch (err) {
        showLocalProblem(`The request could not be sent: ${err.message}`);
    } finally {
        runButton.disabled = false;
        runButton.classList.remove('is-busy');
    }
}

/* ---------------------------------------------------------------- dev solve
   Only wired up when the server ran with --dev-solve and therefore rendered the
   button. It fills the builder with the correct request, sends it, then fills in the
   answer - which for most levels can only be read out of the response, so the
   solution is fetched a second time afterwards. */

function fillRequest(solution) {
    byId('methods')?.querySelector(`.method[data-method="${solution.method}"]`)?.click();

    const route = byId('route');
    if (route) route.value = solution.path;

    const params = byId('params');
    if (params) {
        params.innerHTML = '';
        const names = Object.keys(solution.query || {});
        if (names.length === 0) {
            params.appendChild(makeParamRow());
        } else {
            for (const name of names) params.appendChild(makeParamRow(name, String(solution.query[name])));
        }
    }

    const body = byId('body');
    if (body) body.value = solution.body ? JSON.stringify(solution.body, null, 2) : '';

    refreshPreview();
}

async function devSolve() {
    const button = byId('dev-solve');
    if (!button || game.read_only) return;

    const url = `/api/game/levels/${game.level.id}/solution`;
    button.disabled = true;

    try {
        const recipe = await (await fetch(url)).json();
        if (recipe.error) throw new Error(recipe.message || recipe.error);

        fillRequest(recipe);
        await sendRequest();

        const solved = await (await fetch(url)).json();
        const answer = byId('answer');
        if (!answer) return;

        if (solved.answer === null || solved.answer === undefined) {
            setFeedback('dev solve: the server has no answer for this level yet.', false);
            return;
        }
        answer.value = solved.answer;
        answer.focus();
    } catch (err) {
        setFeedback(`dev solve failed: ${err.message}`, false);
    } finally {
        button.disabled = false;
    }
}

/* ---------------------------------------------------------------- answers */

function setFeedback(message, correct) {
    const feedback = byId('answer-feedback');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = `answer-feedback ${correct ? 'is-right' : 'is-wrong'}`;
}

async function submitAnswer() {
    const input = byId('answer');
    if (!input || game.read_only) return;

    try {
        const response = await fetch(`/api/game/levels/${game.level.id}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: input.value }),
        });
        const data = await response.json();

        setFeedback(data.message, data.correct);

        if (!data.correct) {
            setLevelScore(data.at_stake, false);
            return;
        }
        setLevelScore(data.score, true);

        game.read_only = true;
        game.record.completed = true;
        game.record.score = data.score;
        if (data.progress) game.progress = data.progress;
        game.total_score = data.total_score;
        game.all_done = data.all_done;
        if (data.stepper_html) stepper.innerHTML = data.stepper_html;

        updateChips();
        lockBuilder();

        const next = byId('next-level');
        if (!next) return;

        if (data.next_level) {
            next.hidden = false;
            next.dataset.level = String(data.next_level);
            next.focus();
        } else {
            next.hidden = true;
            setFeedback(`${data.message} Final score: ${data.total_score} points.`, true);
        }
    } catch (err) {
        setFeedback(`Could not reach the server: ${err.message}`, false);
    }
}

function setLevelScore(points, earned) {
    const element = byId('level-score');
    if (!element || points === null || points === undefined) return;
    element.textContent = `${points} pts ${earned ? 'earned' : 'at stake'}`;
}

function updateChips() {
    if (progressChip && game.progress) {
        progressChip.textContent = `${game.progress.solved} / ${game.progress.total} solved`;
    }
    if (scoreChip) scoreChip.textContent = `${game.total_score} pts`;
}

function lockBuilder() {
    const form = byId('builder');
    if (!form) return;

    for (const control of form.querySelectorAll('input, textarea, button')) control.disabled = true;
    form.classList.add('is-locked');

    const answer = byId('answer');
    const submit = byId('submit-answer');
    if (answer) answer.disabled = true;
    if (submit) submit.disabled = true;
}

/* ---------------------------------------------------------------- navigation */

async function goToLevel(id) {
    try {
        const response = await fetch(`/api/game/levels/${id}/view`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Could not open that level.');

        levelPanel.innerHTML = data.html.level;
        docsPanel.innerHTML = data.html.docs;
        stepper.innerHTML = data.html.stepper;

        game = {
            level: data.level,
            read_only: data.read_only,
            record: data.record,
            progress: data.progress,
            total_score: data.total_score,
            has_next: data.has_next,
            all_done: data.all_done,
        };

        updateChips();
        mountLevel();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
        window.alert(err.message);
    }
}

/* ---------------------------------------------------------------- wiring up a level
   Runs once per level, because the panel markup is replaced whenever the player
   moves between levels. */

function mountLevel() {
    selectedMethod = null;

    const methods = byId('methods');
    if (methods) {
        methods.addEventListener('click', event => {
            const button = event.target.closest('.method');
            if (!button || button.disabled) return;

            for (const other of methods.querySelectorAll('.method')) other.classList.remove('is-active');
            button.classList.add('is-active');
            selectedMethod = button.dataset.method;
            refreshPreview();
        });
    }

    const params = byId('params');
    if (params) {
        params.appendChild(makeParamRow());

        params.addEventListener('click', event => {
            const remove = event.target.closest('.btn-del');
            if (!remove || remove.disabled) return;

            const row = remove.closest('.param-row');
            if (params.querySelectorAll('.param-row').length > 1) {
                row.remove();
            } else {
                row.querySelector('.param-name').value = '';
                row.querySelector('.param-value').value = '';
            }
            refreshPreview();
        });

        byId('add-param').addEventListener('click', () => {
            params.appendChild(makeParamRow());
            refreshPreview();
        });
    }

    const form = byId('builder');
    if (form) {
        form.addEventListener('submit', event => {
            event.preventDefault();
            sendRequest();
        });
        form.addEventListener('input', refreshPreview);
    }

    byId('dev-solve')?.addEventListener('click', devSolve);
    byId('submit-answer')?.addEventListener('click', submitAnswer);

    byId('answer')?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submitAnswer();
    });

    const next = byId('next-level');
    if (next) {
        next.addEventListener('click', () => goToLevel(Number(next.dataset.level || game.level.id + 1)));
        if (game.read_only && game.has_next) {
            next.hidden = false;
            next.dataset.level = String(game.level.id + 1);
        }
    }

    // Replay whatever this level last produced, so coming back to a solved level still
    // shows the request and the response that solved it.
    if (game.record?.last) {
        const last = game.record.last;
        renderResponse({
            method: last.method,
            url: last.url,
            status: last.status,
            status_text: '',
            request_ok: last.request_ok,
            hint: last.hint,
            body: last.body,
            headers: null,
        });
    }

    if (game.read_only) lockBuilder();
    refreshPreview();
}

/* ---------------------------------------------------------------- one time wiring */

stepper.addEventListener('click', event => {
    const button = event.target.closest('.step');
    if (!button || button.disabled || button.classList.contains('is-current')) return;
    goToLevel(Number(button.dataset.level));
});

byId('reset')?.addEventListener('click', async () => {
    if (!window.confirm('Clear all progress and start over from level 1?')) return;
    await fetch('/api/game/reset', { method: 'POST' });
    window.location.href = '/';
});

mountLevel();
