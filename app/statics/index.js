/* REST Quest - client side.
   Vanilla JS only. Its job is to help the player build a real HTTP request, send it
   with AJAX, and show what came back. It never decides whether an answer is right:
   that verdict always comes from the server. */

(function () {
    'use strict';

    var state = window.__GAME__;
    var levelPanel = document.getElementById('level-panel');
    var docsPanel = document.getElementById('docs-panel');
    var stepper = document.getElementById('stepper');
    var progressChip = document.getElementById('progress-chip');
    var scoreChip = document.getElementById('score-chip');

    var selectedMethod = null;

    var byId = function (id) { return document.getElementById(id); };

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function statusClass(status) {
        if (status >= 200 && status < 300) return 'ok';
        if (status >= 300 && status < 400) return 'info';
        return 'err';
    }

    /* ---------------------------------------------------------------- query parameter rows */

    function paramRow(name, value) {
        var row = document.createElement('div');
        row.className = 'param-row';
        row.innerHTML =
            '<input type="text" class="param-name" placeholder="name" spellcheck="false" />' +
            '<span class="param-eq">=</span>' +
            '<input type="text" class="param-value" placeholder="value" spellcheck="false" />' +
            '<button type="button" class="btn btn-mini btn-del" title="Remove this parameter">&minus;</button>';
        row.querySelector('.param-name').value = name || '';
        row.querySelector('.param-value').value = value || '';
        return row;
    }

    function buildQuery() {
        var pairs = [];
        var rows = document.querySelectorAll('#params .param-row');
        for (var i = 0; i < rows.length; i++) {
            var name = rows[i].querySelector('.param-name').value.trim();
            var value = rows[i].querySelector('.param-value').value.trim();
            if (name) pairs.push(encodeURIComponent(name) + '=' + encodeURIComponent(value));
        }
        return pairs.join('&');
    }

    function currentUrl() {
        var route = byId('route') ? byId('route').value.trim() : '';
        var query = byId('params') ? buildQuery() : '';
        return route + (query ? '?' + query : '');
    }

    function refreshPreview() {
        var preview = byId('url-preview');
        if (!preview) return;
        var url = currentUrl();
        preview.textContent = (selectedMethod || 'METHOD') + ' ' + (url || '/api/...');
    }

    /* ---------------------------------------------------------------- response panel */

    function renderResponse(result) {
        var box = byId('response');
        if (!box) return;

        var verdict = result.local
            ? '<p class="verdict verdict-local">' + escapeHtml(result.hint) + '</p>'
            : '<p class="verdict ' + (result.request_ok ? 'verdict-ok' : 'verdict-no') + '">' +
              escapeHtml(result.request_ok
                  ? 'This is the request the level asked for. Now read the response and answer below.'
                  : (result.hint || 'That is not the request this level is looking for.')) +
              '</p>';

        if (result.local) {
            box.innerHTML = '<div class="response-card">' +
                '<p class="response-line"><span class="badge badge-err">not sent</span>' +
                '<code>' + escapeHtml(result.method + ' ' + result.url) + '</code></p>' +
                verdict + '</div>';
            return;
        }

        var bodyHtml;
        if (result.status === 204) {
            bodyHtml = '<p class="no-body">No response body - that is exactly what <strong>204 No Content</strong> means: ' +
                'the request succeeded and there was deliberately nothing to send back.</p>';
        } else if (result.body === null || result.body === '') {
            bodyHtml = '<p class="no-body">The response had an empty body.</p>';
        } else if (typeof result.body === 'string') {
            bodyHtml = '<pre class="json">' + escapeHtml(result.body) + '</pre>';
        } else {
            bodyHtml = '<pre class="json">' + escapeHtml(JSON.stringify(result.body, null, 2)) + '</pre>';
        }

        var headersHtml = '';
        if (result.headers && result.headers.length) {
            var rows = result.headers.map(function (h) {
                return '<tr><td><code>' + escapeHtml(h[0]) + '</code></td><td>' + escapeHtml(h[1]) + '</td></tr>';
            }).join('');
            headersHtml = '<details class="headers"><summary>Response headers</summary>' +
                '<table class="header-table"><tbody>' + rows + '</tbody></table></details>';
        }

        var notice = '';
        if (result.notice) {
            notice = '<p class="notice">Server note: ' + escapeHtml(result.notice) + '</p>';
        }

        box.innerHTML = '<div class="response-card">' +
            '<p class="response-line">' +
            '<span class="badge badge-' + statusClass(result.status) + '">' +
            escapeHtml(result.status + (result.status_text ? ' ' + result.status_text : '')) + '</span>' +
            '<code>' + escapeHtml(result.method + ' ' + result.url) + '</code></p>' +
            verdict + notice + bodyHtml + headersHtml +
            '</div>';
    }

    /* ---------------------------------------------------------------- sending the request */

    function localProblem(message) {
        renderResponse({
            local: true,
            method: selectedMethod || 'METHOD',
            url: currentUrl() || '/api/...',
            hint: message,
        });
    }

    function statusTextFor(res) {
        // Some browsers leave statusText empty for HTTP/2, so fall back to nothing.
        return res.statusText || '';
    }

    function run() {
        if (state.read_only) return Promise.resolve();

        if (!selectedMethod) { localProblem('Pick an HTTP method first.'); return Promise.resolve(); }

        var route = byId('route').value.trim();
        if (!route) { localProblem('Type the route you want to call.'); return Promise.resolve(); }
        if (route.charAt(0) !== '/') {
            localProblem('A route has to start with a slash, like /api/items');
            return Promise.resolve();
        }
        if (route.indexOf('?') !== -1) {
            localProblem('Leave the ? out of the route: the query string is built from the parameter rows.');
            return Promise.resolve();
        }

        var options = {
            method: selectedMethod,
            headers: { 'X-Game-Level': String(state.level.id) },
        };

        var bodyField = byId('body');
        var raw = bodyField ? bodyField.value.trim() : '';
        if (raw) {
            if (selectedMethod === 'GET') {
                localProblem('A GET request does not carry a body. Clear it, or pick another method.');
                return Promise.resolve();
            }
            try {
                JSON.parse(raw);
            } catch (err) {
                localProblem('The request body is not valid JSON: ' + err.message);
                return Promise.resolve();
            }
            options.headers['Content-Type'] = 'application/json';
            options.body = raw;
        }

        var url = currentUrl();
        var runButton = byId('run');
        runButton.disabled = true;
        runButton.classList.add('is-busy');

        return fetch(url, options)
            .then(function (res) {
                return res.text().then(function (text) {
                    var body = null;
                    if (text) {
                        try { body = JSON.parse(text); } catch (err) { body = text; }
                    }
                    var headers = [];
                    res.headers.forEach(function (value, key) { headers.push([key, value]); });
                    headers.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });

                    setLevelScore(res.headers.get('X-Game-Level-Score'), false);

                    var hint = res.headers.get('X-Game-Hint');
                    renderResponse({
                        method: options.method,
                        url: url,
                        status: res.status,
                        status_text: statusTextFor(res),
                        request_ok: res.headers.get('X-Game-Request-Ok') === '1',
                        hint: hint ? decodeURIComponent(hint) : null,
                        notice: res.headers.get('X-Notice'),
                        body: body,
                        headers: headers,
                    });

                    if (res.headers.get('X-Game-Request-Ok') === '1') {
                        state.record.request_ok = true;
                        var answer = byId('answer');
                        if (answer) answer.focus();
                    }
                });
            })
            .catch(function (err) {
                localProblem('The request could not be sent: ' + err.message);
            })
            .then(function () {
                runButton.disabled = false;
                runButton.classList.remove('is-busy');
            });
    }

    /* ---------------------------------------------------------------- dev solve
       Only wired up when the server was started with --dev-solve and therefore
       rendered the button. It fills the builder with the correct request, sends it,
       and then fills in the answer - which for most levels can only be read out of
       the response, so the solution is fetched again afterwards. */

    function fillRequest(solution) {
        var methods = byId('methods');
        if (methods) {
            var button = methods.querySelector('.method[data-method="' + solution.method + '"]');
            if (button) button.click();     // reuses the normal selection handler
        }

        var route = byId('route');
        if (route) route.value = solution.path;

        var params = byId('params');
        if (params) {
            params.innerHTML = '';
            var names = Object.keys(solution.query || {});
            if (names.length === 0) {
                params.appendChild(paramRow('', ''));
            } else {
                names.forEach(function (name) {
                    params.appendChild(paramRow(name, String(solution.query[name])));
                });
            }
        }

        var body = byId('body');
        if (body) body.value = solution.body ? JSON.stringify(solution.body, null, 2) : '';

        refreshPreview();
    }

    function devSolve() {
        var button = byId('dev-solve');
        if (!button || state.read_only) return;

        var url = '/api/game/levels/' + state.level.id + '/solution';
        var feedback = byId('answer-feedback');
        button.disabled = true;

        fetch(url)
            .then(function (res) { return res.json(); })
            .then(function (solution) {
                if (solution.error) throw new Error(solution.message || solution.error);
                fillRequest(solution);
                return run();
            })
            .then(function () { return fetch(url); })
            .then(function (res) { return res.json(); })
            .then(function (solution) {
                var answer = byId('answer');
                if (!answer) return;
                if (solution.answer === null || solution.answer === undefined) {
                    if (feedback) {
                        feedback.textContent = 'dev solve: the server has no answer for this level yet.';
                        feedback.className = 'answer-feedback is-wrong';
                    }
                    return;
                }
                answer.value = solution.answer;
                answer.focus();
            })
            .catch(function (err) {
                if (feedback) {
                    feedback.textContent = 'dev solve failed: ' + err.message;
                    feedback.className = 'answer-feedback is-wrong';
                }
            })
            .then(function () { button.disabled = false; });
    }

    /* ---------------------------------------------------------------- answers */

    function submitAnswer() {
        var input = byId('answer');
        var feedback = byId('answer-feedback');
        if (!input || state.read_only) return;

        fetch('/api/game/levels/' + state.level.id + '/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: input.value }),
        })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                feedback.textContent = data.message;
                feedback.className = 'answer-feedback ' + (data.correct ? 'is-right' : 'is-wrong');
                if (!data.correct) {
                    setLevelScore(data.at_stake, false);
                    return;
                }
                setLevelScore(data.score, true);

                state.read_only = true;
                state.record.completed = true;
                state.record.score = data.score;
                if (data.progress) state.progress = data.progress;
                state.total_score = data.total_score;
                state.all_done = data.all_done;
                if (data.stepper_html) stepper.innerHTML = data.stepper_html;
                updateChips();
                lockBuilder();

                var next = byId('next-level');
                if (next && data.next_level) {
                    next.hidden = false;
                    next.dataset.level = String(data.next_level);
                    next.focus();
                } else if (next) {
                    next.hidden = true;
                    feedback.textContent = data.message + ' Final score: ' + data.total_score + ' points.';
                }
            })
            .catch(function (err) {
                feedback.textContent = 'Could not reach the server: ' + err.message;
                feedback.className = 'answer-feedback is-wrong';
            });
    }

    function setLevelScore(points, earned) {
        var el = byId('level-score');
        if (el && points !== null && points !== undefined) {
            el.textContent = points + (earned ? ' pts earned' : ' pts at stake');
        }
    }

    function updateChips() {
        if (progressChip && state.progress) {
            progressChip.textContent = state.progress.solved + ' / ' + state.progress.total + ' solved';
        }
        if (scoreChip) scoreChip.textContent = state.total_score + ' pts';
    }

    function lockBuilder() {
        var form = byId('builder');
        if (!form) return;
        var controls = form.querySelectorAll('input, textarea, button');
        for (var i = 0; i < controls.length; i++) controls[i].disabled = true;
        form.classList.add('is-locked');

        var answer = byId('answer');
        var submit = byId('submit-answer');
        if (answer) answer.disabled = true;
        if (submit) submit.disabled = true;
    }

    /* ---------------------------------------------------------------- navigation */

    function goToLevel(id) {
        fetch('/api/game/levels/' + id + '/view')
            .then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) throw new Error(data.message || 'Could not open that level.');
                    return data;
                });
            })
            .then(function (data) {
                levelPanel.innerHTML = data.html.level;
                docsPanel.innerHTML = data.html.docs;
                stepper.innerHTML = data.html.stepper;
                state = {
                    level: data.level,
                    read_only: data.read_only,
                    record: data.record,
                    progress: data.progress,
                    total_score: data.total_score,
                    has_next: data.has_next,
                    all_done: data.all_done,
                };
                updateChips();
                mount();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            })
            .catch(function (err) { window.alert(err.message); });
    }

    /* ---------------------------------------------------------------- wiring up a level */

    function mount() {
        selectedMethod = null;

        var methods = byId('methods');
        if (methods) {
            methods.addEventListener('click', function (event) {
                var button = event.target.closest('.method');
                if (!button || button.disabled) return;
                var all = methods.querySelectorAll('.method');
                for (var i = 0; i < all.length; i++) all[i].classList.remove('is-active');
                button.classList.add('is-active');
                selectedMethod = button.dataset.method;
                refreshPreview();
            });
        }

        var params = byId('params');
        if (params) {
            params.appendChild(paramRow('', ''));
            params.addEventListener('click', function (event) {
                var del = event.target.closest('.btn-del');
                if (!del || del.disabled) return;
                var rows = params.querySelectorAll('.param-row');
                if (rows.length > 1) del.closest('.param-row').remove();
                else {
                    del.closest('.param-row').querySelector('.param-name').value = '';
                    del.closest('.param-row').querySelector('.param-value').value = '';
                }
                refreshPreview();
            });
            byId('add-param').addEventListener('click', function () {
                params.appendChild(paramRow('', ''));
                refreshPreview();
            });
        }

        var form = byId('builder');
        if (form) {
            form.addEventListener('submit', function (event) { event.preventDefault(); run(); });
            form.addEventListener('input', refreshPreview);
        }

        var devButton = byId('dev-solve');
        if (devButton) devButton.addEventListener('click', devSolve);

        var submit = byId('submit-answer');
        if (submit) submit.addEventListener('click', submitAnswer);

        var answerInput = byId('answer');
        if (answerInput) {
            answerInput.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') { event.preventDefault(); submitAnswer(); }
            });
        }

        var next = byId('next-level');
        if (next) {
            next.addEventListener('click', function () {
                var target = next.dataset.level || (state.level.id + 1);
                goToLevel(Number(target));
            });
            if (state.read_only && state.has_next) {
                next.hidden = false;
                next.dataset.level = String(state.level.id + 1);
            }
        }

        // Replay whatever this level last produced, so going back to a solved level
        // still shows the request and the response that solved it.
        if (state.record && state.record.last) {
            var last = state.record.last;
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

        if (state.read_only) lockBuilder();
        refreshPreview();
    }

    /* ---------------------------------------------------------------- one time wiring */

    stepper.addEventListener('click', function (event) {
        var button = event.target.closest('.step');
        if (!button || button.disabled || button.classList.contains('is-current')) return;
        goToLevel(Number(button.dataset.level));
    });

    var reset = byId('reset');
    if (reset) {
        reset.addEventListener('click', function () {
            if (!window.confirm('Clear all progress and start over from level 1?')) return;
            fetch('/api/game/reset', { method: 'POST' })
                .then(function () { window.location.href = '/'; });
        });
    }

    mount();
})();
