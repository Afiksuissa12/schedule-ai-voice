'use strict';
// Minimal client for the Schedule AI Voice web demo. All text from the server or the model is
// inserted with textContent - never innerHTML - so nothing a visitor or the model writes can
// become markup or script.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var log = $('log'), input = $('input'), send = $('send'), status = $('status');
  var sessionId = null;
  var busy = false;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function scroll() { log.scrollTop = log.scrollHeight; }
  function addMessage(role, text) {
    var m = el('div', 'msg ' + role);
    m.appendChild(el('span', 'who', role === 'contact' ? 'You (' + ($('contact').textContent || 'contact') + ')' : 'Assistant (generated live by the language model)'));
    m.appendChild(document.createTextNode(text));
    log.appendChild(m); scroll();
  }
  function addEvent(kind, text) { log.appendChild(el('div', 'event ' + kind, text)); scroll(); }
  function setBusy(b, text) {
    busy = b; send.disabled = b; input.disabled = b; $('followup').disabled = b; $('reset').disabled = b;
    status.textContent = text || '';
  }

  async function api(method, path, body) {
    var res = await fetch(path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = {};
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) { var err = new Error(data.error || ('Request failed (' + res.status + ')')); err.status = res.status; throw err; }
    return data;
  }

  function renderHeader(s) {
    $('contact').textContent = s.contactName;
    $('company').textContent = s.company;
    $('tz').textContent = s.contactTimezone;
    $('now').textContent = s.nowLocal;
    if (s.model) $('model').textContent = s.model;
  }

  function renderActions(d) {
    var box = $('actions'); box.textContent = '';
    var items = [];
    (d.futureActions || []).forEach(function (a) {
      items.push({ title: a.type === 'CALL_CONTACT' ? 'Callback (FutureAction)' : ('FutureAction ' + a.type), status: a.status, when: a.local, id: a.id });
    });
    (d.meetings || []).forEach(function (m) {
      items.push({ title: 'Meeting', status: m.status, when: m.local, id: m.id });
    });
    if (items.length === 0) { box.appendChild(el('p', 'empty', 'Nothing scheduled yet.')); return; }
    items.forEach(function (it) {
      var c = el('div', 'card' + (it.status === 'DONE' ? ' done' : ''));
      c.appendChild(el('div', 't', it.title + ' - ' + it.status));
      c.appendChild(el('div', '', it.when));
      c.appendChild(el('div', 's', 'id ' + it.id));
      box.appendChild(c);
    });
  }

  function renderAudit(events) {
    var ol = $('audit'); ol.textContent = '';
    if (!events || events.length === 0) { ol.appendChild(el('li', 'empty', 'No events.')); return; }
    events.forEach(function (e) {
      var li = el('li');
      li.appendChild(el('code', '', e.type));
      li.appendChild(document.createTextNode(' ' + e.summary));
      ol.appendChild(li);
    });
  }

  function replay(transcript) {
    log.textContent = '';
    (transcript || []).forEach(function (t) {
      if (t.role === 'system') addEvent(t.text.indexOf('REFUSED') >= 0 ? 'bad' : (t.text.indexOf('CLAIM GATE') === 0 ? 'info' : 'ok'), t.text);
      else addMessage(t.role, t.text);
    });
  }

  async function startNew() {
    setBusy(true, 'Starting a new conversation...');
    try {
      var s = await api('POST', '/api/session');
      sessionId = s.sessionId;
      try { localStorage.setItem('sav-session', sessionId); } catch (e) { /* storage unavailable */ }
      renderHeader(s); replay([]); renderActions({}); renderAudit([]); $('followupResult').textContent = '';
      addEvent('info', 'New conversation started. You are ' + s.contactName + '. Say hello, ask about the product, or ask for a callback.');
    } catch (e) { addEvent('bad', e.message); }
    setBusy(false);
    input.focus();
  }

  async function restoreOrStart() {
    var saved = null;
    try { saved = localStorage.getItem('sav-session'); } catch (e) { /* storage unavailable */ }
    if (saved) {
      try {
        var s = await api('GET', '/api/session?id=' + encodeURIComponent(saved));
        sessionId = s.sessionId; renderHeader(s); replay(s.transcript); renderActions(s);
        addEvent('info', 'Conversation restored from this browser session.');
        return;
      } catch (e) { /* expired - start fresh */ }
    }
    await startNew();
  }

  async function sendMessage(text) {
    if (busy || !text || !sessionId) return;
    addMessage('contact', text); input.value = '';
    var thinking = el('div', 'thinking', 'The assistant is thinking...'); log.appendChild(thinking); scroll();
    setBusy(true, 'Waiting for the language model...');
    try {
      var d = await api('POST', '/api/message', { sessionId: sessionId, text: text });
      thinking.remove();
      (d.agent || []).forEach(function (m) { addMessage('agent', m); });
      (d.tools || []).forEach(function (t) {
        addEvent(t.ok ? 'ok' : 'bad', (t.ok ? 'Application validated and saved - ' : 'Application refused - ') + t.tool + ': ' + t.detail);
      });
      if (d.withheld) addEvent('info', 'Safety gate: the assistant\'s reply was withheld because the claim gate could not verify its wording against what was saved (for example, how it phrased the time). Nothing unverified was said to you; in a real deployment a person would take over. Anything the application saved is shown in the panel.');
      renderActions(d); renderAudit(d.auditEvents);
      status.textContent = d.turnsLeft + ' turns left in this demo conversation.';
    } catch (e) {
      thinking.remove(); addEvent('bad', e.message);
      if (e.status === 404) { sessionId = null; }
    }
    setBusy(false, status.textContent);
    input.focus();
  }

  async function followUp() {
    if (busy || !sessionId) return;
    setBusy(true, 'Running the follow-up engine...');
    try {
      var d = await api('POST', '/api/followup', { sessionId: sessionId });
      renderActions(d);
      if (!d.ran) { $('followupResult').textContent = d.message; }
      else {
        var txt = 'Executed ' + d.executed + ' action(s) with no model involved';
        if (d.calls && d.calls.length) txt += ' - simulated call to ' + d.calls.map(function (c) { return c.to + ' (' + c.status + ')'; }).join(', ');
        $('followupResult').textContent = txt + '.';
        addEvent('ok', 'Follow-up engine: ' + txt + '.');
      }
    } catch (e) { $('followupResult').textContent = e.message; }
    setBusy(false);
  }

  $('form').addEventListener('submit', function (ev) { ev.preventDefault(); sendMessage(input.value.trim()); });
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
    c.addEventListener('click', function () { sendMessage(c.textContent); });
  });
  $('reset').addEventListener('click', function () { try { localStorage.removeItem('sav-session'); } catch (e) { /* ignore */ } startNew(); });
  $('followup').addEventListener('click', followUp);
  restoreOrStart();
})();
