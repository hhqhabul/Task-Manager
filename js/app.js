/* Task Manager – add/render/persist + Filters + Delete (custom confirm) + Toggle + Edit dialog
   + Sorting (robust) + Sort persistence + Export/Import JSON + Toasts
   + Manual sort (drag & drop + keyboard) with order persistence
   + Settings + Due-date reminders (Notifications + toast fallback) */
(function () {
  // ---------- tiny utils ----------
  function $(s, el){ return (el || document).querySelector(s); }
  function startOfDay(d){ var x = new Date(d); x.setHours(0,0,0,0); return x; }
  function fmtDate(iso){ return iso ? new Date(iso).toLocaleDateString() : "—"; }
  function uid(){
    try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch(e){}
    return String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  }

  // ---------- storage ----------
  var KEY = "tm.tasks.v1";
  var KEY_SORT = "tm.sort.v1";
  function load(){ try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch(e){ return []; } }
  function save(list){ localStorage.setItem(KEY, JSON.stringify(list)); }

  // ---------- state & elements ----------
  var tasks = load();
  var filters = { q:"", priority:"", due:"", tag:"", sort:"created" };
  var editingId = null;

  var el = {
    // add form
    form: $("#task-form"),
    title: $("#title"),
    description: $("#description"),
    due: $("#due"),
    priority: $("#priority"),
    tags: $("#tags"),
    status: $("#status"),
    feedback: $("#form-feedback"),

    // filters
    fForm: $("#filter-form"),
    q: $("#q"),
    fPriority: $("#f-priority"),
    fDue: $("#f-due"),
    fTag: $("#f-tag"),
    fSort: $("#f-sort"),

    // list & counters
    list: $("#task-list"),
    emptyMsg: $("#empty-message"),
    countTotal: $("#count-total"),
    countOpen: $("#count-open"),
    countDone: $("#count-done"),
    progress: $("#progress"),

    // template + edit dialog
    tpl: $("#task-item-template"),
    editDialog: $("#edit-dialog"),
    editForm: $("#edit-form"),
    editTitle: $("#edit-title-input"),
    editNotes: $("#edit-notes-input"),
    editDue: $("#edit-due-input"),
    editPriority: $("#edit-priority-input"),

    // confirm dialog + toasts
    cDialog: $("#confirm-dialog"),
    cForm: $("#confirm-form"),
    cDesc: $("#confirm-desc"),
    toastStack: $("#toast-stack"),

    // data tools
    btnExport: $("#btn-export"),
    btnImport: $("#btn-import"),
    inputImport: $("#import-file"),  // ✅ missing comma fixed

    // settings
    sForm: $("#settings-form"),
    optRem: $("#opt-reminders"),
    optTime: $("#opt-remind-time")
  };

  // ---------- toasts ----------
  function showToast(message, type, timeout){
    type = type || "info"; timeout = timeout == null ? 3000 : timeout;
    if (!el.toastStack) { console.warn("toast stack not found"); return; }
    var wrap = document.createElement("div");
    wrap.className = "toast toast--" + type;

    var btn = document.createElement("button");
    btn.className = "toast__close"; btn.setAttribute("aria-label","Dismiss");
    btn.innerHTML = "×";
    btn.addEventListener("click", function(){ if (wrap.parentNode) el.toastStack.removeChild(wrap); });

    var p = document.createElement("p");
    p.className = "toast__msg";
    p.textContent = message;

    wrap.appendChild(btn); wrap.appendChild(p);
    el.toastStack.appendChild(wrap);
    if (timeout > 0) setTimeout(function(){ if (wrap.parentNode) el.toastStack.removeChild(wrap); }, timeout);
  }

  // ---------- custom confirm (Promise-based) ----------
  function confirmAction(message, opts){
    opts = opts || {};
    return new Promise(function(resolve){
      if (!el.cDialog || !el.cForm || !el.cDesc || !el.cDialog.showModal) {
        resolve(window.confirm(message)); return;
      }
      el.cDesc.textContent = message;
      var okBtn = el.cForm.querySelector('button[value="ok"]');
      if (okBtn) {
        okBtn.textContent = opts.okLabel || "OK";
        okBtn.classList.toggle("danger", !!opts.danger);
      }
      function trap(e){
        if (e.key !== "Tab") return;
        var f = el.cDialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        f = Array.prototype.slice.call(f).filter(function(x){ return !x.disabled && x.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length-1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      el.cDialog.addEventListener("keydown", trap);
      el.cDialog.addEventListener("close", function onClose(){
        el.cDialog.removeEventListener("keydown", trap);
        el.cDialog.removeEventListener("close", onClose);
        resolve(el.cDialog.returnValue === "ok");
      });
      el.cDialog.showModal();
      if (okBtn) okBtn.focus();
    });
  }

  // ---------- migrations (order field) ----------
  (function migrateOrder(){
    var needs = tasks.some(function(t){ return typeof t.order !== "number"; });
    if (needs){
      tasks.sort(function(a,b){ return new Date(a.createdAt) - new Date(b.createdAt); });
      tasks.forEach(function(t,i){ t.order = i+1; });
      save(tasks);
    }
  })();

  // Restore saved sort on boot
  try {
    var savedSort = localStorage.getItem(KEY_SORT);
    if (savedSort) {
      filters.sort = savedSort;
      if (el.fSort) el.fSort.value = savedSort;
    }
  } catch(_) {}

  // ---------- helpers ----------
  function parseTags(s){
    return (s || "").split(",").map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean);
  }
  function hasActiveFilters(){
    return !!(filters.q || filters.priority || filters.due || filters.tag);
  }
  function nextOrder(){
    var max = 0; for (var i=0;i<tasks.length;i++){ var o = tasks[i].order|0; if (o > max) max = o; }
    return max + 1;
  }
  function matchesFilters(t){
    if (filters.q && t.title.toLowerCase().indexOf(filters.q.toLowerCase()) === -1) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.tag) {
      var ok = (t.tags || []).some(function(tag){ return tag.indexOf(filters.tag.toLowerCase()) !== -1; });
      if (!ok) return false;
    }
    if (filters.due){
      if (!t.due) return false;
      var now = startOfDay(new Date());
      var due = startOfDay(new Date(t.due));
      var diff = Math.round((due - now) / (1000*60*60*24));
      if (filters.due === "today" && diff !== 0) return false;
      if (filters.due === "week" && (diff < 0 || diff > 6)) return false;
      if (filters.due === "overdue" && diff >= 0) return false;
    }
    return true;
  }

  // Build <li> either from template or fallback DOM
  function buildItem(t, position){
    if (el.tpl && el.tpl.content && el.tpl.content.firstElementChild){
      var li = el.tpl.content.firstElementChild.cloneNode(true);
      li.setAttribute("data-id", t.id);
      li.querySelector('meta[itemprop="position"]').setAttribute("content", String(position));
      var article = li.querySelector("article"); article.tabIndex = 0;

      var h3 = li.querySelector("h3[itemprop='name']");
      var titleId = "t-" + t.id + "-title";
      h3.id = titleId; h3.textContent = t.title;
      article.setAttribute("aria-labelledby", titleId);

      var pDesc = li.querySelector("p[itemprop='description']");
      if (t.description) pDesc.textContent = t.description; else pDesc.parentNode.removeChild(pDesc);

      var prioEl = li.querySelector("data[itemprop='priority']");
      prioEl.value = t.priority;
      prioEl.textContent = t.priority === "high" ? "High" : (t.priority === "low" ? "Low" : "Medium");

      var timeEl = li.querySelector("time[itemprop='endTime']");
      if (t.due){ timeEl.setAttribute("datetime", t.due); timeEl.textContent = fmtDate(t.due); }
      else { timeEl.removeAttribute("datetime"); timeEl.textContent = "—"; }

      var tagsSpan = li.querySelector(".tags");
      if (tagsSpan) {
        tagsSpan.textContent = "";
        if (t.tags && t.tags.length) {
          t.tags.forEach(function(tag, i){
            if (i) tagsSpan.appendChild(document.createTextNode(", "));
            var a = document.createElement("a");
            a.href = "#filters"; a.rel = "tag"; a.dataset.tag = tag; a.textContent = tag;
            tagsSpan.appendChild(a);
          });
        } else { tagsSpan.textContent = "—"; }
      }

      var statusEl = li.querySelector("data[itemprop='actionStatus']");
      statusEl.value = t.status;
      statusEl.textContent = (t.status === "done" ? "Done" : (t.status === "inprogress" ? "In progress" : "To do"));

      var actions = li.querySelector("div[aria-label='Actions']");
      if (actions) {
        var btns = actions.querySelectorAll("button");
        // Expect order: drag-handle, edit, delete, toggle
        if (btns[0]) btns[0].classList.add("drag-handle");
        if (btns[1]) { btns[1].dataset.action = "edit";   btns[1].disabled = false; btns[1].removeAttribute("aria-disabled"); }
        if (btns[2]) { btns[2].dataset.action = "delete"; btns[2].disabled = false; btns[2].removeAttribute("aria-disabled"); }
        if (btns[3]) { btns[3].dataset.action = "toggle"; btns[3].disabled = false; btns[3].removeAttribute("aria-disabled"); }
      }

      if (t.status === "done") article.setAttribute("data-done","true"); else article.removeAttribute("data-done");
      return li;
    }

    // Fallback DOM
    var li2 = document.createElement("li");
    li2.setAttribute("data-id", t.id);
    li2.setAttribute("itemprop","itemListElement"); li2.setAttribute("itemscope",""); li2.setAttribute("itemtype","https://schema.org/ListItem");
    var meta = document.createElement("meta"); meta.setAttribute("itemprop","position"); meta.content = String(position);

    var art = document.createElement("article"); art.tabIndex = 0; art.setAttribute("itemscope",""); art.setAttribute("itemtype","https://schema.org/ToDoAction");
    var h = document.createElement("h3"); h.setAttribute("itemprop","name"); h.textContent = t.title;
    var p = document.createElement("p"); p.setAttribute("itemprop","description"); if (t.description) p.textContent = t.description; else p = null;

    var ul = document.createElement("ul"); ul.setAttribute("aria-label","Task metadata");
    ul.innerHTML =
      '<li>Priority: <data itemprop="priority">'+t.priority+'</data></li>' +
      '<li>Due: <time itemprop="endTime" datetime="'+(t.due||"")+'">'+fmtDate(t.due)+'</time></li>' +
      '<li>Tags: '+(t.tags && t.tags.length ? t.tags.map(function(tag){ return '<a href="#filters" rel="tag" data-tag="'+tag+'">'+tag+'</a>'; }).join(", ") : "—")+'</li>' +
      '<li>Status: <data itemprop="actionStatus">'+(t.status==="done"?"Done":(t.status==="inprogress"?"In progress":"To do"))+'</data></li>';

    var actions2 = document.createElement("div");
    actions2.setAttribute("aria-label","Actions");
    actions2.innerHTML =
      '<button type="button" class="drag-handle" aria-label="Drag to reorder" title="Drag to reorder" hidden>↕</button> ' +
      '<button type="button" data-action="edit">Edit</button> ' +
      '<button type="button" data-action="delete">Delete</button> ' +
      '<button type="button" data-action="toggle">Toggle</button>';

    art.appendChild(h);
    if (p) art.appendChild(p);
    art.appendChild(ul);
    art.appendChild(actions2);
    li2.appendChild(meta); li2.appendChild(art);
    return li2;
  }

  // ---------- core ----------
  function addTask(data){
    var now = new Date().toISOString();
    var task = {
      id: uid(),
      title: (data.title || "").trim(),
      description: (data.description || "").trim(),
      due: data.due || "",
      priority: data.priority || "med",
      tags: parseTags(data.tags),
      status: data.status || "todo",
      createdAt: now,
      updatedAt: now,
      order: nextOrder()
    };
    tasks.push(task);
    save(tasks);
    return task;
  }

  function updateCounters(view){
    var total = tasks.length;
    var done = tasks.filter(function(t){ return t.status === "done"; }).length;
    var open = total - done;
    el.countTotal.textContent = total;
    el.countOpen.textContent = open;
    el.countDone.textContent = done;

    var pct = total ? Math.round(done/total*100) : 0;
    el.progress.max = 100; el.progress.value = pct;
    el.progress.setAttribute("aria-valuenow", String(pct));
    el.progress.setAttribute("aria-valuemax", "100");
    el.progress.setAttribute("aria-label", "Completion " + pct + "%");

    if (view.length === 0){
      el.emptyMsg.hidden = false;
      el.emptyMsg.textContent = total ? "No tasks match your filters. Click Clear to show all." : "No tasks yet. Add one above!";
    } else { el.emptyMsg.hidden = true; }
  }

  function render(){
    el.list.innerHTML = "";
    var view = tasks.filter(matchesFilters);

    // sort by selected mode
    view.sort(function(a, b){
      var s = filters.sort || "created";
      if (s === "manual") {
        return (a.order|0) - (b.order|0);
      }
      if (s === "due-asc") {
        var ad = a.due || "", bd = b.due || "";
        return ad === bd ? 0 : (ad < bd ? -1 : 1);
      }
      if (s === "due-desc") {
        var ad2 = a.due || "", bd2 = b.due || "";
        return ad2 === bd2 ? 0 : (ad2 > bd2 ? -1 : 1);
      }
      if (s === "prio") {
        var rank = { high: 0, med: 1, low: 2 };
        var ra = (rank[a.priority] != null) ? rank[a.priority] : 99;
        var rb = (rank[b.priority] != null) ? rank[b.priority] : 99;
        if (ra !== rb) return ra - rb;
        var ad3 = a.due || "", bd3 = b.due || "";
        if (ad3 !== bd3) return ad3 < bd3 ? -1 : 1;
        return new Date(a.createdAt) - new Date(b.createdAt);
      }
      if (s === "status") {
        var order = { inprogress: 0, todo: 1, done: 2 };
        return (order[a.status]||9) - (order[b.status]||9);
      }
      // default: createdAt (oldest first)
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    var allowReorder = (filters.sort === "manual") && !hasActiveFilters();

    var pos = 1;
    for (var i=0;i<view.length;i++){
      var li = buildItem(view[i], pos++);
      // enable/disable drag affordances
      li.draggable = !!allowReorder;
      var handle = li.querySelector(".drag-handle");
      if (handle) handle.hidden = !allowReorder;
      el.list.appendChild(li);
    }
    updateCounters(view);
  }

  // ---------- Settings (load/save) + Reminders ----------
  var KEY_SETTINGS = "tm.settings.v1";
  var KEY_NOTIFIED = "tm.notified.v1"; // { [taskId]: "YYYY-MM-DD" }

  var settings = loadSettings();
  var notified = loadNotified();

  // apply settings to controls on boot
  if (el.optRem) el.optRem.checked = !!settings.enableReminders;
  if (el.optTime) el.optTime.value = settings.remindTime || "09:00";

  // wire settings form
  if (el.sForm) {
    el.sForm.addEventListener("submit", function(e){
      e.preventDefault();
      settings.enableReminders = !!(el.optRem && el.optRem.checked);
      settings.remindTime = (el.optTime && el.optTime.value) || "09:00";
      saveSettings(settings);
      if (settings.enableReminders) ensureNotificationPermission();
      scheduleReminders(true);
      showToast("Settings saved.", "success", 1500);
    });
  }

  function loadSettings(){
    try { return JSON.parse(localStorage.getItem(KEY_SETTINGS) || "{}"); } catch(e){ return {}; }
  }
  function saveSettings(s){
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(s || {}));
  }
  function loadNotified(){
    try { return JSON.parse(localStorage.getItem(KEY_NOTIFIED) || "{}"); } catch(e){ return {}; }
  }
  function markNotified(id, dateStr){
    notified[id] = dateStr;
    localStorage.setItem(KEY_NOTIFIED, JSON.stringify(notified));
  }

  function ensureNotificationPermission(){
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      try { Notification.requestPermission().catch(function(){}); } catch(_) {}
    }
  }

  function parseTimeHHMM(t){
    var m = /^(\d{1,2}):(\d{2})$/.exec(t||"");
    var h = m ? Math.min(23, Math.max(0, parseInt(m[1],10))) : 9;
    var mi = m ? Math.min(59, Math.max(0, parseInt(m[2],10))) : 0;
    return {h:h, m:mi};
  }

  var reminderTimers = [];
  function clearReminders(){
    while (reminderTimers.length) clearTimeout(reminderTimers.pop());
  }

  function scheduleReminders(showHint){
    clearReminders();
    if (!settings.enableReminders) return;

    ensureNotificationPermission();
    var time = parseTimeHHMM(settings.remindTime || "09:00");

    tasks.forEach(function(t){
      if (!t.due || t.status === "done") return;

      var due = new Date(t.due + "T00:00:00");
      due.setHours(time.h, time.m, 0, 0);

      var delay = due.getTime() - Date.now();
      var dueStr = t.due;

      if (notified[t.id] === dueStr) return;

      if (delay <= 0) {
        reminderTimers.push(setTimeout(function(){ fireReminder(t); }, 300));
        return;
      }
      if (delay < 30*24*60*60*1000) {
        reminderTimers.push(setTimeout(function(){ fireReminder(t); }, delay));
      }
    });

    if (showHint) showToast("Reminders scheduled.", "info", 1400);
  }

  function fireReminder(task){
    var t = tasks.find(function(x){ return x.id === task.id; });
    if (!t || t.status === "done") return;

    var title = t.title || "Task due";
    var body = (t.description ? t.description + "\n" : "") +
               "Due: " + (t.due || "—") + (t.priority ? " • Priority: " + t.priority.toUpperCase() : "");

    var showedNative = false;
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body: body, tag: "task-"+t.id });
        showedNative = true;
      } catch(_) {}
    }
    if (!showedNative) showToast("Due: " + title, "warn", 4000);

    markNotified(t.id, t.due);
  }

  // ---------- Edit helpers ----------
  function openEditDialog(task){
    editingId = task.id;
    if (el.editTitle) el.editTitle.value = task.title || "";
    if (el.editNotes) el.editNotes.value = task.description || "";
    if (el.editDue) el.editDue.value = task.due || "";
    if (el.editPriority) el.editPriority.value = task.priority || "med";

    if (el.editDialog && el.editDialog.showModal) {
      el.editDialog.showModal();
    } else {
      var newTitle = window.prompt("Edit title:", task.title);
      if (newTitle && newTitle.trim().length >= 2) {
        task.title = newTitle.trim();
        task.updatedAt = new Date().toISOString();
        save(tasks); render(); scheduleReminders(false);
      }
      editingId = null;
    }
  }

  if (el.editDialog){
    el.editDialog.addEventListener("close", function(){
      if (this.returnValue !== "save") { editingId = null; return; }
      var idx = tasks.findIndex(function(t){ return t.id === editingId; });
      if (idx === -1) { editingId = null; return; }
      var t = tasks[idx];

      var title = (el.editTitle && el.editTitle.value || "").trim();
      if (title.length < 2) { el.feedback.textContent = "Title must be at least 2 characters."; return; }

      t.title = title;
      t.description = el.editNotes ? el.editNotes.value : t.description;
      t.due = el.editDue ? el.editDue.value : t.due;
      t.priority = el.editPriority ? el.editPriority.value : t.priority;
      t.updatedAt = new Date().toISOString();
      save(tasks);
      render();
      scheduleReminders(false);
      editingId = null;
      showToast("Task updated.", "success", 2000);
    });
  }

  // ---------- events ----------
  if (el.form){
    el.form.addEventListener("submit", function(e){
      e.preventDefault();
      var title = (el.title.value || "").trim();
      if (title.length < 2){
        el.feedback.textContent = "Please enter a longer title (≥ 2 characters).";
        showToast("Title must be at least 2 characters.", "warn");
        el.title.focus();
        return;
      }
      var t = addTask({
        title: title,
        description: el.description.value,
        due: el.due.value,
        priority: el.priority.value,
        tags: el.tags.value,
        status: el.status.value
      });

      if (hasActiveFilters() && !matchesFilters(t)){
        filters.q = filters.priority = filters.due = filters.tag = "";
        if (el.fForm) el.fForm.reset();
        el.feedback.textContent = "Added! Filters were cleared so you can see your new task.";
      } else { el.feedback.textContent = "Task added!"; }

      el.form.reset(); el.title.focus(); render();
      scheduleReminders(false);
      showToast("Task added.", "success", 2000);
    });
  }

  if (el.fForm){
    el.fForm.addEventListener("submit", function(e){
      e.preventDefault();
      filters.q        = (el.q && el.q.value ? el.q.value.trim() : "");
      filters.priority = (el.fPriority && el.fPriority.value) || "";
      filters.due      = (el.fDue && el.fDue.value) || "";
      filters.tag      = (el.fTag && el.fTag.value ? el.fTag.value.trim().toLowerCase() : "");
      filters.sort     = (el.fSort && el.fSort.value) || "created";
      try { localStorage.setItem(KEY_SORT, filters.sort); } catch(_) {}
      render();
      showToast("Filters applied.", "info", 1500);
      if (filters.sort === "manual" && hasActiveFilters()) {
        showToast('To reorder, clear filters first.', "info", 2000);
      }
    });
    el.fForm.addEventListener("reset", function(){
      setTimeout(function(){
        filters.q = filters.priority = filters.due = filters.tag = "";
        filters.sort = "created";
        try { localStorage.setItem(KEY_SORT, filters.sort); } catch(_) {}
        if (el.fSort) el.fSort.value = "created";
        render();
        showToast("Filters cleared.", "info", 1500);
      }, 0);
    });
  }

  if (el.fSort) {
    el.fSort.addEventListener("change", function () {
      filters.sort = el.fSort.value || "created";
      try { localStorage.setItem(KEY_SORT, filters.sort); } catch(_) {}
      render();
      if (filters.sort === "manual" && hasActiveFilters()) {
        showToast('To reorder, clear filters first.', "info", 2000);
      }
    });
  }

  // Tag chip → set Tag filter
  if (el.list){
    el.list.addEventListener("click", function(e){
      var a = e.target.closest ? e.target.closest("a[rel='tag'][data-tag]") : null;
      if (!a) return;
      e.preventDefault();
      var tag = a.getAttribute("data-tag") || "";
      if (el.fTag) el.fTag.value = tag;
      filters.tag = tag;
      var details = $("#filters details"); if (details && !details.open) details.open = true;
      render();
    });

    // Actions: Delete / Toggle / Edit (delegated)
    el.list.addEventListener("click", function(e){
      var btn = e.target.closest ? e.target.closest("button[data-action]") : null;
      if (!btn) return;
      var li = btn.closest("li");
      var id = li && li.getAttribute("data-id");
      if (!id) return;

      var idx = tasks.findIndex(function(t){ return t.id === id; });
      if (idx < 0) return;

      var action = btn.getAttribute("data-action");
      if (action === "delete"){
        var tsk = tasks[idx];
        var msg = 'Delete "' + (tsk.title || "this task") + '"? This cannot be undone.';
        confirmAction(msg, { okLabel: "Delete", danger: true }).then(function(ok){
          if (!ok) return;
          tasks.splice(idx, 1);
          save(tasks);
          render();
          scheduleReminders(false);
          if (el.feedback) el.feedback.textContent = "Task deleted.";
          showToast("Task deleted.", "success", 1800);
        });
      } else if (action === "toggle"){
        var t = tasks[idx];
        t.status = (t.status === "done") ? "todo" : "done";
        t.updatedAt = new Date().toISOString();
        save(tasks);
        render();
        scheduleReminders(false);
      } else if (action === "edit"){
        openEditDialog(tasks[idx]);
      }
    });
  }

  // ---------- Drag & Drop ----------
  var dragState = { id: null, overEl: null, after: false };

  function allowReorderNow() {
    var ok = (filters.sort === "manual") && !hasActiveFilters();
    if (!ok) showToast('Switch Sort to "Manual" and clear filters to reorder.', "warn", 2200);
    return ok;
  }

  function cleanupDrag(){
    var dragging = el.list.querySelector('li.dragging');
    if (dragging) dragging.classList.remove('dragging');
    var over = el.list.querySelectorAll('.drop-before,.drop-after');
    over.forEach(function(n){ n.classList.remove('drop-before','drop-after'); });
    dragState.id = null; dragState.overEl = null; dragState.after = false;
  }

  function moveTask(srcId, targetId, placeAfter){
    var arr = tasks.slice().sort(function(a,b){ return (a.order|0)-(b.order|0); });
    var si = arr.findIndex(function(t){ return t.id === srcId; });
    var ti = arr.findIndex(function(t){ return t.id === targetId; });
    if (si < 0 || ti < 0) return;
    var item = arr.splice(si,1)[0];
    if (si < ti) ti--;
    var newIdx = placeAfter ? ti+1 : ti;
    if (newIdx < 0) newIdx = 0;
    if (newIdx > arr.length) newIdx = arr.length;
    arr.splice(newIdx, 0, item);
    arr.forEach(function(t,i){ t.order = i+1; });
    save(tasks); render();
  }

  el.list.addEventListener('dragstart', function(e){
    var li = e.target.closest && e.target.closest('li');
    if (!li) return;
    if (!allowReorderNow()) { e.preventDefault(); return; }
    dragState.id = li.getAttribute('data-id');
    if (!dragState.id) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragState.id); } catch(_) {}
    li.classList.add('dragging');
  });

  el.list.addEventListener('dragover', function(e){
    if (!dragState.id) return;
    e.preventDefault();
    var li = e.target.closest && e.target.closest('li');
    if (!li || li.getAttribute('data-id') === dragState.id) return;
    var rect = li.getBoundingClientRect();
    var after = (e.clientY - rect.top) > rect.height/2;
    if (dragState.overEl && dragState.overEl !== li){
      dragState.overEl.classList.remove('drop-before','drop-after');
    }
    dragState.overEl = li; dragState.after = after;
    li.classList.toggle('drop-before', !after);
    li.classList.toggle('drop-after', after);
  });

  el.list.addEventListener('dragleave', function(e){
    var li = e.target.closest && e.target.closest('li');
    if (li) li.classList.remove('drop-before','drop-after');
  });

  el.list.addEventListener('drop', function(e){
    if (!dragState.id) return;
    e.preventDefault();
    var li = e.target.closest && e.target.closest('li');
    if (li && li.getAttribute('data-id') && li.getAttribute('data-id') !== dragState.id){
      moveTask(dragState.id, li.getAttribute('data-id'), dragState.after);
    }
    cleanupDrag();
  });

  el.list.addEventListener('dragend', cleanupDrag);

  // ---------- Keyboard reordering (Shift+Arrow keys) ----------
  el.list.addEventListener('keydown', function(e){
    if (!(e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    if (!(e.shiftKey)) return;
    if (!((filters.sort === "manual") && !hasActiveFilters())) { showToast('Switch Sort to "Manual" and clear filters to reorder.', "warn", 2200); return; }

    var li = e.target.closest && e.target.closest('li');
    if (!li) return;
    e.preventDefault();

    var id = li.getAttribute('data-id');
    var arr = tasks.slice().sort(function(a,b){ return (a.order|0)-(b.order|0); });
    var idx = arr.findIndex(function(t){ return t.id === id; });
    if (idx < 0) return;

    var newIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= arr.length) return;

    var targetId = arr[newIdx].id;
    moveTask(id, targetId, e.key === 'ArrowDown');

    setTimeout(function(){
      var focusEl = $('#task-list li[data-id="'+id+'"] .drag-handle') || $('#task-list li[data-id="'+id+'"]');
      if (focusEl && focusEl.focus) focusEl.focus();
    }, 0);
  });

  // ---------- Export / Import ----------
  function downloadJson(filename, dataObj) {
    var blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  if (el.btnExport) {
    el.btnExport.addEventListener("click", function () {
      var stamp = new Date();
      var yyyy = stamp.getFullYear(), mm = String(stamp.getMonth()+1).padStart(2,"0");
      var dd = String(stamp.getDate()).padStart(2,"0"), hh = String(stamp.getHours()).padStart(2,"0");
      var mi = String(stamp.getMinutes()).padStart(2,"0"), ss = String(stamp.getSeconds()).padStart(2,"0");
      var name = "tasks-" + yyyy + mm + dd + "-" + hh + mi + ss + ".json";

      var payload = { schema: "tm.tasks.v1", exportedAt: stamp.toISOString(), tasks: tasks };
      downloadJson(name, payload);
      if (el.feedback) el.feedback.textContent = "Exported " + tasks.length + " task(s).";
      showToast("Exported " + tasks.length + " task(s).", "success", 1800);
    });
  }

  if (el.btnImport && el.inputImport) {
    el.btnImport.addEventListener("click", function () {
      el.inputImport.value = "";
      el.inputImport.click();
    });

    el.inputImport.addEventListener("change", function () {
      var file = el.inputImport.files && el.inputImport.files[0];
      if (!file) return;

      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = JSON.parse(String(ev.target.result || "{}"));
          var incoming = Array.isArray(data) ? data : (Array.isArray(data.tasks) ? data.tasks : []);
          if (!incoming.length) { if (el.feedback) el.feedback.textContent = "Import file has no tasks."; showToast("Import file has no tasks.", "warn"); return; }

          confirmAction("Replace existing tasks with imported tasks?\nOK = Replace, Cancel = Merge", { okLabel: "Replace", danger: true })
          .then(function(replace){
            if (replace) {
              var needs = incoming.some(function(t){ return typeof t.order !== "number"; });
              if (needs) incoming.forEach(function(t, i){ t.order = i+1; });
              tasks = incoming;
            } else {
              var byId = Object.create(null);
              tasks.forEach(function(t){ byId[t.id || (t.title+"|"+t.createdAt)] = t; });
              incoming.forEach(function(t){
                var key = t.id || (t.title+"|"+t.createdAt);
                if (typeof t.order !== "number") t.order = nextOrder();
                byId[key] = t;
              });
              tasks = Object.keys(byId).map(function(k){ return byId[k]; });
            }
            save(tasks);
            render();
            scheduleReminders(false);
            if (el.feedback) el.feedback.textContent = "Imported " + incoming.length + " task(s).";
            showToast("Imported " + incoming.length + " task(s).", "success", 1800);
          });
        } catch (e) {
          if (el.feedback) el.feedback.textContent = "Import failed: invalid JSON.";
          showToast("Import failed: invalid JSON.", "error", 2800);
          console.error(e);
        }
      };
      reader.readAsText(file);
    });
  }

  // ---------- keyboard niceties ----------
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key === "/") { e.preventDefault(); var inp = el.q || el.title; if (inp) inp.focus(); }
  });

  // ---------- boot ----------
  console.info("Task Manager JS loaded with manual drag & drop + keyboard reordering + reminders.");
  render();
  scheduleReminders(false); // schedule once on boot
})();
