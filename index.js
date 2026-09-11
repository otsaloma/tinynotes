// -*- coding: utf-8-unix -*-
/* global atob, crypto, document, fetch, localStorage, location, navigator, window */

const API_URL = "https://q3yno9wuoi.execute-api.eu-north-1.amazonaws.com";
const COGNITO_CLIENT_ID = "30j2jbt002e8c3sh053sq6oa3i";
const COGNITO_DOMAIN = "eu-north-1fmmzfb35t.auth.eu-north-1.amazoncognito.com";

const ACCOUNT = new URLSearchParams(location.search).get("u") || "1";
const DEMO = new URLSearchParams(location.search).has("demo");

const BULLET = "\u2022";
const FOLD_COLLAPSED = "⋯";
const FOLD_OPEN = "⋮";
const NBSP = "\u00a0";
const SYNC_DEBOUNCE_MS = 3000;
const UNDO_LIMIT = 100;

let currentVersion = null;
let dragDidDrop = false;
let dragState = null;
let focusedItem = null;
let focusEntry = null;
let hasUnsyncedChanges = false;
let isTouchDevice = navigator.maxTouchPoints > 0;
let redoStack = [];
let selectedItems = [];
let selectionAnchor = null;
let suppressSelectionClear = false;
let syncTimeout = null;
let textDragState = null;
let undoStack = [];
let zoomedId = null;

function listAllIds() {
    return Array.from(document.querySelectorAll(".item[data-id]")).map(el => el.dataset.id);
}

function generateId(length=6) {
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, length);
    if (listAllIds().includes(id))
        return generateId(length + 1);
    return id;
}

function createItem(text, color) {
    const item = document.createElement("div");
    item.className = "item";
    item.dataset.id = generateId();
    const row = document.createElement("div");
    row.className = "row";
    const toggle = document.createElement("span");
    toggle.className = "toggle";
    toggle.textContent = NBSP;
    const bullet = document.createElement("span");
    bullet.className = "bullet";
    bullet.textContent = BULLET;
    const textEl = document.createElement("div");
    textEl.className = "text";
    textEl.contentEditable = "true";
    textEl.textContent = text || "";
    if (color) {
        item.dataset.color = color;
        textEl.classList.add(`bg-${color}`);
    }
    row.appendChild(toggle);
    row.appendChild(bullet);
    row.appendChild(textEl);
    item.appendChild(row);
    const children = document.createElement("div");
    children.className = "children";
    item.appendChild(children);
    return item;
}

function getItemEl(id) {
    return document.querySelector(`.item[data-id="${id}"]`);
}

function getTextEl(item) {
    return item.querySelector(":scope > .row > .text");
}

function getChildrenEl(item) {
    return item.querySelector(":scope > .children");
}

// The text being edited, or null if the caret is elsewhere.
function getFocusedText() {
    const el = document.activeElement;
    return el.classList.contains("text") ? el : null;
}

function setFocusedItem(item) {
    if (focusedItem)
        focusedItem.classList.remove("focused");
    focusedItem = item;
    if (focusedItem)
        focusedItem.classList.add("focused");
}

function hasChildren(item) {
    return getChildrenEl(item).querySelector(":scope > .item") !== null;
}

// Items live either in #outline or in the .children div of their
// parent, so the parent is the item owning that div, if any. Siblings
// are for the same reason always items, use *ElementSibling directly.
function getParentItem(item) {
    return item.parentElement.closest(".item");
}

// Items in document order, skipping those collapsed or zoomed out of
// view. Visibility is decided by the text, as the rows of the zoom root
// and its ancestors are hidden while the items themselves are not.
function getVisibleItems() {
    const items = document.querySelectorAll("#outline .item");
    return Array.from(items).filter(item => getTextEl(item).checkVisibility());
}

function updateToggle(item) {
    const toggle = item.querySelector(":scope > .row > .toggle");
    if (hasChildren(item)) {
        toggle.textContent = item.classList.contains("collapsed") ? FOLD_COLLAPSED : FOLD_OPEN;
    } else {
        toggle.textContent = NBSP;
    }
}

function clearSelection() {
    for (const item of selectedItems)
        item.classList.remove("selected");
    selectedItems = [];
    selectionAnchor = null;
}

function setSelection(items) {
    for (const item of selectedItems)
        item.classList.remove("selected");
    selectedItems = items;
    for (const item of items)
        item.classList.add("selected");
}

function getSelectionRoots() {
    const set = new Set(selectedItems);
    return selectedItems.filter(item => {
        const parent = getParentItem(item);
        return !parent || !set.has(parent);
    });
}

function groupRootsByParent(roots) {
    const groups = [];
    let current = null;
    for (const root of roots) {
        const parent = root.parentElement;
        if (!current || current.parent !== parent) {
            current = { parent, roots: [] };
            groups.push(current);
        }
        current.roots.push(root);
    }
    return groups;
}

// Shift+Arrow grows or shrinks a contiguous selection of visible
// items. The anchor end stays put, the head end moves by one and the
// selection spans the two. Shrinking to a single item drops the
// selection and puts the caret back into that item.
function extendSelection(e, delta) {
    e.preventDefault();
    const item = document.activeElement.closest(".item");
    if (!item) return;
    const visibleItems = getVisibleItems();
    let anchorIdx = visibleItems.indexOf(item);
    let headIdx = anchorIdx;
    if (selectedItems.length > 0) {
        anchorIdx = visibleItems.indexOf(selectionAnchor);
        const firstIdx = visibleItems.indexOf(selectedItems[0]);
        const lastIdx = visibleItems.indexOf(selectedItems[selectedItems.length - 1]);
        headIdx = anchorIdx === firstIdx ? lastIdx : firstIdx;
    }
    headIdx += delta;
    if (anchorIdx < 0 || headIdx < 0 || headIdx >= visibleItems.length) return;
    const anchor = visibleItems[anchorIdx];
    const start = Math.min(anchorIdx, headIdx);
    const end = Math.max(anchorIdx, headIdx);
    if (start === end) {
        clearSelection();
        focusItemEnd(anchor);
        return;
    }
    setSelection(visibleItems.slice(start, end + 1));
    selectionAnchor = anchor;
    window.getSelection().removeAllRanges();
}

function handleTabMulti() {
    checkpoint();
    const activeText = getFocusedText();
    const cursorPos = activeText ? getCursorPos(activeText) : null;
    const selectedSet = new Set(selectedItems);
    const roots = getSelectionRoots();
    const groups = groupRootsByParent(roots);
    for (const group of groups) {
        let target = group.roots[0].previousElementSibling;
        while (target && selectedSet.has(target))
            target = target.previousElementSibling;
        if (!target) continue;
        if (target.classList.contains("collapsed"))
            target.classList.remove("collapsed");
        const targetChildrenEl = getChildrenEl(target);
        const oldParent = getParentItem(group.roots[0]);
        for (const root of group.roots)
            targetChildrenEl.appendChild(root);
        updateToggle(target);
        if (oldParent) updateToggle(oldParent);
    }
    if (cursorPos !== null) {
        suppressSelectionClear = true;
        activeText.focus();
        setCursorPos(activeText, cursorPos);
    }
    save();
}

function handleShiftTabMulti() {
    checkpoint();
    const activeText = getFocusedText();
    const cursorPos = activeText ? getCursorPos(activeText) : null;
    const selectedSet = new Set(selectedItems);
    const roots = getSelectionRoots();
    const groups = groupRootsByParent(roots);
    for (const group of groups) {
        const firstRoot = group.roots[0];
        const lastRoot = group.roots[group.roots.length - 1];
        const parentItem = getParentItem(firstRoot);
        if (!parentItem) continue;
        if (parentItem.classList.contains("zoom-root")) continue;
        const grandparentContainer = parentItem.parentElement;
        // Gather following non-selected siblings after last root
        const followingSiblings = [];
        let sibling = lastRoot.nextElementSibling;
        while (sibling) {
            if (!selectedSet.has(sibling))
                followingSiblings.push(sibling);
            sibling = sibling.nextElementSibling;
        }
        // Move following siblings into last root's children
        const lastChildrenEl = getChildrenEl(lastRoot);
        for (const s of followingSiblings)
            lastChildrenEl.appendChild(s);
        // Move group roots after parentItem in grandparent
        let insertRef = parentItem.nextSibling;
        for (const root of group.roots) {
            grandparentContainer.insertBefore(root, insertRef);
            insertRef = root.nextSibling;
        }
        updateToggle(parentItem);
        for (const root of group.roots)
            updateToggle(root);
    }
    if (cursorPos !== null) {
        suppressSelectionClear = true;
        activeText.focus();
        setCursorPos(activeText, cursorPos);
    }
    save();
}

function toggleCompleteMulti() {
    checkpoint();
    // Complete unless everything selected is already complete.
    const completing = selectedItems.some(it => !it.classList.contains("completed"));
    for (const root of getSelectionRoots())
        setCompleted(root, completing);
    save();
}

function handleDeleteMulti() {
    checkpoint();
    const selectedSet = new Set(selectedItems);
    const roots = getSelectionRoots();
    const firstRoot = roots[0];
    const lastRoot = roots[roots.length - 1];
    // Find focus target in visible document order
    const visibleItems = getVisibleItems();
    const firstIdx = visibleItems.indexOf(firstRoot);
    const lastIdx = visibleItems.indexOf(lastRoot);
    let focusTarget = null;
    for (let i = firstIdx - 1; i >= 0; i--) {
        if (!selectedSet.has(visibleItems[i])) {
            focusTarget = visibleItems[i];
            break;
        }
    }
    if (!focusTarget) {
        for (let i = lastIdx + 1; i < visibleItems.length; i++) {
            if (!selectedSet.has(visibleItems[i])) {
                focusTarget = visibleItems[i];
                break;
            }
        }
    }
    if (!focusTarget) focusTarget = getParentItem(firstRoot);
    // Collect original parents for toggle refresh
    const parents = new Set();
    for (const root of roots) {
        const parent = getParentItem(root);
        if (parent) parents.add(parent);
    }
    // Remove all roots (descendants go with them)
    for (const root of roots)
        root.remove();
    clearSelection();
    for (const parent of parents)
        updateToggle(parent);
    if (focusTarget) suppressSelectionClear = true;
    focusAfterRemoval(focusTarget, null);
    save();
}

const COLOR_CHOICES = ["yellow", "orange", "red", "violet", "blue", "green"];

const COLOR_SHORTCUTS = {
    "y": "yellow",
    "o": "orange",
    "r": "red",
    "v": "violet",
    "b": "blue",
    "g": "green",
};

function applyColor(item, color) {
    checkpoint();
    const textEl = getTextEl(item);
    for (const c of COLOR_CHOICES)
        textEl.classList.remove(`bg-${c}`);
    if (color) {
        item.dataset.color = color;
        textEl.classList.add(`bg-${color}`);
    } else {
        delete item.dataset.color;
    }
    save();
}

// Completion covers the whole subtree, a bullet with something left
// undone under it is not done.
function setCompleted(item, completed) {
    for (const el of [item, ...item.querySelectorAll(".item")])
        el.classList.toggle("completed", completed);
}

function toggleComplete(item) {
    checkpoint();
    const completing = !item.classList.contains("completed");
    setCompleted(item, completing);
    if (completing) {
        const nextItem = item.nextElementSibling;
        if (nextItem) getTextEl(nextItem).focus();
    }
    save();
}

function copyItemProperties(from, to) {
    if (from.dataset.color) {
        to.dataset.color = from.dataset.color;
        getTextEl(to).classList.add(`bg-${from.dataset.color}`);
    }
    if (from.classList.contains("completed"))
        to.classList.add("completed");
    if (from.classList.contains("collapsed"))
        to.classList.add("collapsed");
}

function clearItemProperties(item) {
    if (item.dataset.color) {
        getTextEl(item).classList.remove(`bg-${item.dataset.color}`);
        delete item.dataset.color;
    }
    item.classList.remove("completed");
    item.classList.remove("collapsed");
}

function itemToText(item, indent) {
    const text = getTextEl(item).textContent;
    const prefix = "    ".repeat(indent);
    let result = `${prefix}- ${text}\n`;
    const childrenEl = getChildrenEl(item);
    for (const child of childrenEl.querySelectorAll(":scope > .item"))
        result += itemToText(child, indent + 1);
    return result;
}

function copyAsText(items, verb="Copied") {
    const text = items.map(item => itemToText(item, 0)).join("");
    navigator.clipboard.writeText(text);
    notify(`${verb} ${items.length} ${items.length === 1 ? "bullet" : "bullets"}`);
}

// Ctrl+Shift+C copies the selection if there is one, else the bullet
// being edited, and does nothing if the caret is outside the outline.
function copySelectionOrFocused() {
    if (selectedItems.length > 0)
        return copyAsText(getSelectionRoots());
    const textEl = getFocusedText();
    if (textEl) copyAsText([textEl.closest(".item")]);
}

let notifyTimeout;
function notify(message) {
    let toast = document.getElementById("toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = "1";
    clearTimeout(notifyTimeout);
    notifyTimeout = setTimeout(() => { toast.style.opacity = "0"; }, 1500);
}

const urlPattern = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+/g;

function renderLinks(textEl) {
    const text = textEl.textContent;
    urlPattern.lastIndex = 0;
    if (!urlPattern.test(text)) return;
    urlPattern.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const a = document.createElement("a");
        a.href = match[0];
        a.textContent = match[0];
        a.target = "_blank";
        a.rel = "noopener";
        frag.appendChild(a);
        lastIndex = urlPattern.lastIndex;
    }
    if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textEl.innerHTML = "";
    textEl.appendChild(frag);
}

function stripLinks(textEl) {
    const hasLinks = textEl.querySelector("a");
    if (!hasLinks) return;
    textEl.textContent = textEl.textContent;
}

function renderAllLinks() {
    const allTexts = document.querySelectorAll("#outline .text");
    for (const textEl of allTexts)
        renderLinks(textEl);
}

function getCursorPos(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return 0;
    const preRange = document.createRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
}

function setCursorPos(el, pos) {
    const range = document.createRange();
    const sel = window.getSelection();
    if (el.childNodes.length === 0) {
        range.setStart(el, 0);
    } else {
        const node = el.childNodes[0];
        range.setStart(node, Math.min(pos, node.textContent.length));
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
}

function focusItemStart(item) {
    const textEl = getTextEl(item);
    textEl.focus();
    setCursorPos(textEl, 0);
}

function focusItemEnd(item) {
    const textEl = getTextEl(item);
    textEl.focus();
    setCursorPos(textEl, textEl.textContent.length);
}

// Put the caret where removed items were: at the end of what was above
// them, or failing that at the start of what was below. The outline
// must never be left empty, there would be nothing to type into.
function focusAfterRemoval(prevItem, nextItem) {
    const outline = document.getElementById("outline");
    if (!outline.querySelector(".item")) {
        const item = createItem("");
        outline.appendChild(item);
        getTextEl(item).focus();
    } else if (prevItem) {
        focusItemEnd(prevItem);
    } else if (nextItem) {
        focusItemStart(nextItem);
    }
}

function serialize(container) {
    const items = container.querySelectorAll(":scope > .item");
    const result = [];
    for (const item of items) {
        const data = {
            id: item.dataset.id,
            text: getTextEl(item).textContent,
        };
        if (item.classList.contains("collapsed")) data.collapsed = true;
        if (item.classList.contains("completed")) data.completed = true;
        if (item.dataset.color) data.color = item.dataset.color;
        const children = serialize(getChildrenEl(item));
        if (children.length > 0) data.children = children;
        result.push(data);
    }
    return result;
}

function deserialize(items, container) {
    for (const data of items) {
        const item = createItem(data.text, data.color);
        item.dataset.id = data.id;
        if (data.collapsed) {
            item.classList.add("collapsed");
        }
        if (data.completed)
            item.classList.add("completed");
        container.appendChild(item);
        if (data.children && data.children.length > 0) {
            deserialize(data.children, getChildrenEl(item));
        }
        updateToggle(item);
    }
}

function save() {
    if (DEMO) return;
    const outline = document.getElementById("outline");
    const data = {
        zoomedId: zoomedId,
        items: serialize(outline),
    };
    localStorage.setItem(storageKey("notes"), JSON.stringify(data));
    hasUnsyncedChanges = true;
    updateSyncStatus("pending");
    debouncedSync();
}

function updateSyncStatus(state, status) {
    const el = document.getElementById("sync-status");
    if (!el) return;
    el.classList.remove("sync-error");
    if (state === "syncing") {
        el.textContent = "syncing...";
    } else if (state === "synced") {
        el.textContent = "synced";
        setTimeout(() => {
            if (el.textContent === "synced") el.textContent = "";
        }, 3000);
    } else if (state === "pending") {
        el.textContent = "sync pending";
    } else if (state === "error") {
        el.textContent = `sync error ${status}`;
        el.classList.add("sync-error");
    } else if (state === "conflict") {
        el.textContent = "sync conflict";
        el.classList.add("sync-error");
    }
}

async function syncToRemote(retry) {
    const token = localStorage.getItem(storageKey("id_token"));
    if (!token) {
        hasUnsyncedChanges = false;
        return;
    }
    const outline = document.getElementById("outline");
    const items = serialize(outline);
    updateSyncStatus("syncing");
    try {
        const response = await fetch(`${API_URL}/notes`, {
            method: "POST",
            headers: {"Authorization": `Bearer ${token}`},
            body: JSON.stringify({items: items, version: currentVersion}),
        });
        if (response.ok) {
            const data = await response.json();
            currentVersion = data.version;
            localStorage.setItem(storageKey("notes"), JSON.stringify({
                zoomedId: zoomedId,
                items: items,
            }));
            hasUnsyncedChanges = false;
            updateSyncStatus("synced");
        } else if (response.status === 409) {
            updateSyncStatus("conflict");
        } else if (response.status === 401 && !retry) {
            const refreshed = await refreshTokens();
            if (refreshed) await syncToRemote(true);
            else updateSyncStatus("error", response.status);
        } else {
            updateSyncStatus("error", response.status);
        }
    } catch {
        updateSyncStatus("error");
    }
}

function debouncedSync() {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => syncToRemote(), SYNC_DEBOUNCE_MS);
}

window.addEventListener("beforeunload", e => {
    if (hasUnsyncedChanges) e.preventDefault();
});

async function fetchFromRemote(retry) {
    const token = localStorage.getItem(storageKey("id_token"));
    if (!token) return null;
    try {
        const response = await fetch(`${API_URL}/notes`, {
            method: "GET",
            headers: {"Authorization": `Bearer ${token}`},
        });
        if (response.ok) {
            const data = await response.json();
            currentVersion = data.version;
            return data;
        }
        if (response.status === 401 && !retry) {
            const refreshed = await refreshTokens();
            if (refreshed) return await fetchFromRemote(true);
        }
        updateSyncStatus("error", response.status);
        return null;
    } catch {
        updateSyncStatus("error");
        return null;
    }
}

function captureState() {
    const outline = document.getElementById("outline");
    const state = {
        items: serialize(outline),
        zoomedId: zoomedId,
        focusId: null,
        cursorPos: 0,
    };
    const textEl = getFocusedText();
    if (textEl) {
        state.focusId = textEl.closest(".item").dataset.id;
        state.cursorPos = getCursorPos(textEl);
    }
    return state;
}

function pushUndo(state) {
    undoStack.push(state || captureState());
    if (undoStack.length > UNDO_LIMIT)
        undoStack.splice(0, undoStack.length - UNDO_LIMIT);
    redoStack = [];
}

// End the run of typing that started when the caret entered a bullet,
// recording the state from before it so that the run undoes as one
// step. A bullet that has since been removed counts as changed.
function commitTextEdit() {
    if (!focusEntry) return;
    const item = getItemEl(focusEntry.itemId);
    const text = item ? getTextEl(item).textContent : null;
    const entry = focusEntry;
    focusEntry = null;
    if (text !== entry.text)
        pushUndo(entry.state);
}

// Close any run of typing and record the state to undo back to.
function checkpoint() {
    commitTextEdit();
    pushUndo();
}

function restoreState(state) {
    const outline = document.getElementById("outline");
    outline.innerHTML = "";
    deserialize(state.items, outline);
    setFocusedItem(null);
    zoomedId = state.zoomedId || null;
    applyZoom();
    renderAllLinks();
    save();
    focusEntry = null;
    if (state.focusId) {
        const item = getItemEl(state.focusId);
        if (item) {
            const textEl = getTextEl(item);
            stripLinks(textEl);
            textEl.focus();
            setFocusedItem(item);
            setCursorPos(textEl, state.cursorPos);
            focusEntry = {
                itemId: state.focusId,
                text: textEl.textContent,
                state: captureState(),
            };
        }
    }
}

function undo() {
    commitTextEdit();
    if (undoStack.length === 0) return;
    redoStack.push(captureState());
    restoreState(undoStack.pop());
    notify("Undo");
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(captureState());
    restoreState(redoStack.pop());
    notify("Redo");
}

function applyZoom() {
    const outline = document.getElementById("outline");
    const els = outline.querySelectorAll(".zoom-root, .zoom-ancestor, .zoom-hidden");
    for (const el of els)
        el.classList.remove("zoom-root", "zoom-ancestor", "zoom-hidden");
    const zoomTitle = document.getElementById("zoom-title");
    zoomTitle.textContent = "";
    if (!zoomedId) {
        // At home everything is visible, no need for dropdowns.
        renderBreadcrumbs([{ id: "root", text: "Home" }], false);
        return;
    }
    const target = getItemEl(zoomedId);
    if (!target) {
        zoomedId = null;
        applyZoom();
        return;
    }
    target.classList.add("zoom-root");
    // Hide siblings of zoom-root
    const rootParent = target.parentElement;
    for (const sibling of rootParent.children) {
        if (sibling !== target && sibling.classList.contains("item")) {
            sibling.classList.add("zoom-hidden");
        }
    }
    // Walk up ancestors
    let ancestor = getParentItem(target);
    while (ancestor) {
        ancestor.classList.add("zoom-ancestor");
        const parent = ancestor.parentElement;
        for (const sibling of parent.children) {
            if (sibling !== ancestor && sibling.classList.contains("item")) {
                sibling.classList.add("zoom-hidden");
            }
        }
        ancestor = getParentItem(ancestor);
    }
    // Build breadcrumb (hierarchy above zoomed item only)
    const crumbs = [{ id: "root", text: "Home" }];
    let node = getParentItem(target);
    const ancestorCrumbs = [];
    while (node) {
        const text = getTextEl(node).textContent || "(empty)";
        ancestorCrumbs.push({ id: node.dataset.id, text: text });
        node = getParentItem(node);
    }
    ancestorCrumbs.reverse();
    crumbs.push(...ancestorCrumbs);
    renderBreadcrumbs(crumbs, true);
    // Show zoomed item text as title
    zoomTitle.textContent = getTextEl(target).textContent || "(empty)";
}

function renderBreadcrumbs(crumbs, menus) {
    const breadcrumbs = document.getElementById("breadcrumbs");
    breadcrumbs.innerHTML = "";
    for (const crumb of crumbs) {
        const span = document.createElement("span");
        span.className = "breadcrumb";
        span.dataset.id = crumb.id;
        span.textContent = crumb.text;
        breadcrumbs.appendChild(span);
        const menu = menus && createBreadcrumbMenu(crumb.id);
        if (menu) breadcrumbs.appendChild(menu);
    }
}

// Dropdown listing the direct children of a breadcrumb, allowing to
// zoom to a sibling of the item currently zoomed to.
function createBreadcrumbMenu(id) {
    const parent = id === "root" ? document.getElementById("outline") : getChildrenEl(getItemEl(id));
    const children = Array.from(parent.querySelectorAll(":scope > .item"));
    if (children.length === 0) return null;
    const menu = document.createElement("span");
    menu.className = "breadcrumb-menu";
    const toggle = document.createElement("span");
    toggle.className = "breadcrumb-toggle";
    toggle.textContent = "▼";
    menu.appendChild(toggle);
    const popover = document.createElement("div");
    popover.className = "popover breadcrumb-popover";
    for (const child of children.slice(0, 10)) {
        const row = document.createElement("div");
        row.className = "breadcrumb-row menu-action";
        row.dataset.id = child.dataset.id;
        row.textContent = getTextEl(child).textContent || "(empty)";
        popover.appendChild(row);
    }
    if (children.length > 10) {
        const row = document.createElement("div");
        row.className = "breadcrumb-row";
        row.textContent = "...";
        popover.appendChild(row);
    }
    menu.appendChild(popover);
    return menu;
}

function dismissBreadcrumbMenus() {
    for (const el of document.querySelectorAll(".breadcrumb-popover.visible"))
        el.classList.remove("visible");
}

// Zooming into a bullet with nothing under it would show an empty
// page, so give it a child to type into.
function zoomIntoItem(item) {
    zoomTo(item.dataset.id);
    if (hasChildren(item)) return;
    pushUndo();
    const child = createItem("");
    getChildrenEl(item).appendChild(child);
    updateToggle(item);
    save();
    getTextEl(child).focus();
}

function zoomTo(id) {
    commitTextEdit();
    zoomedId = id === "root" ? null : id;
    applyZoom();
    if (zoomedId) {
        location.hash = zoomedId;
    } else {
        window.history.replaceState(null, "", location.pathname + location.search);
    }
}

function handleEnter(e) {
    e.preventDefault();
    checkpoint();
    const textEl = e.target;
    const item = textEl.closest(".item");
    const cursorPos = getCursorPos(textEl);
    const text = textEl.textContent;
    if (cursorPos >= text.length) {
        const childrenEl = getChildrenEl(item);
        if (hasChildren(item) && !item.classList.contains("collapsed")) {
            const newItem = createItem("");
            childrenEl.insertBefore(newItem, childrenEl.firstChild);
            updateToggle(item);
            getTextEl(newItem).focus();
        } else {
            const newItem = createItem("");
            item.parentElement.insertBefore(newItem, item.nextSibling);
            const parentItem = getParentItem(item);
            if (parentItem) updateToggle(parentItem);
            getTextEl(newItem).focus();
        }
    } else {
        const before = text.substring(0, cursorPos);
        const after = text.substring(cursorPos);
        textEl.textContent = before;
        const newItem = createItem(after);
        copyItemProperties(item, newItem);
        item.parentElement.insertBefore(newItem, item.nextSibling);
        if (cursorPos === 0) {
            clearItemProperties(item);
            const oldChildren = getChildrenEl(item);
            const newChildren = getChildrenEl(newItem);
            while (oldChildren.firstChild)
                newChildren.appendChild(oldChildren.firstChild);
            updateToggle(item);
            updateToggle(newItem);
        }
        const parentItem = getParentItem(item);
        if (parentItem) updateToggle(parentItem);
        const newTextEl = getTextEl(newItem);
        newTextEl.focus();
        setCursorPos(newTextEl, 0);
    }
    save();
}

function handleDelete(e) {
    const textEl = e.target;
    const item = textEl.closest(".item");
    const text = textEl.textContent;
    const cursorPos = getCursorPos(textEl);
    if (cursorPos !== text.length) return;
    const sel = window.getSelection();
    if (!sel.isCollapsed) return;
    if (text !== "" || hasChildren(item)) return;
    const visibleItems = getVisibleItems();
    const nextItem = visibleItems[visibleItems.indexOf(item) + 1];
    if (!nextItem) return;
    e.preventDefault();
    checkpoint();
    const parentItem = getParentItem(item);
    item.remove();
    if (parentItem) updateToggle(parentItem);
    focusItemStart(nextItem);
    save();
}

function handleBackspace(e) {
    const textEl = e.target;
    const item = textEl.closest(".item");
    const cursorPos = getCursorPos(textEl);
    if (cursorPos !== 0) return;
    const sel = window.getSelection();
    if (!sel.isCollapsed) return;
    e.preventDefault();
    checkpoint();
    const text = textEl.textContent;
    const childrenEl = getChildrenEl(item);
    if (text === "" && !hasChildren(item)) {
        const visibleItems = getVisibleItems();
        const idx = visibleItems.indexOf(item);
        const prevItem = visibleItems[idx - 1];
        const nextItem = visibleItems[idx + 1];
        const parentItem = getParentItem(item);
        item.remove();
        if (parentItem) updateToggle(parentItem);
        focusAfterRemoval(prevItem, nextItem);
    } else if (text === "" && hasChildren(item)) {
        const parentContainer = item.parentElement;
        const parentItem = getParentItem(item);
        const nextSibling = item.nextSibling;
        const visibleItems = getVisibleItems();
        const children = Array.from(childrenEl.querySelectorAll(":scope > .item"));
        // The first child is not among the visible items if collapsed.
        const idx = visibleItems.indexOf(children[0]);
        const prevItem = idx > 0 ? visibleItems[idx - 1] : null;
        for (const child of children)
            parentContainer.insertBefore(child, nextSibling);
        item.remove();
        if (parentItem) updateToggle(parentItem);
        if (prevItem) focusItemEnd(prevItem);
    } else {
        const visibleItems = getVisibleItems();
        const idx = visibleItems.indexOf(item);
        if (idx <= 0) return;
        const prevItem = visibleItems[idx - 1];
        const prevTextEl = getTextEl(prevItem);
        const prevLen = prevTextEl.textContent.length;
        prevTextEl.textContent += text;
        const children = Array.from(childrenEl.querySelectorAll(":scope > .item"));
        const prevChildrenEl = getChildrenEl(prevItem);
        for (const child of children)
            prevChildrenEl.appendChild(child);
        const parentItem = getParentItem(item);
        item.remove();
        if (parentItem) updateToggle(parentItem);
        updateToggle(prevItem);
        prevTextEl.focus();
        setCursorPos(prevTextEl, prevLen);
    }
    save();
}

function indentItem(textEl) {
    checkpoint();
    const item = textEl.closest(".item");
    const prevItem = item.previousElementSibling;
    if (!prevItem) return;
    const cursorPos = getCursorPos(textEl);
    const prevChildrenEl = getChildrenEl(prevItem);
    prevChildrenEl.appendChild(item);
    if (prevItem.classList.contains("collapsed")) {
        prevItem.classList.remove("collapsed");
    }
    updateToggle(prevItem);
    const oldParent = getParentItem(prevItem);
    if (oldParent) updateToggle(oldParent);
    textEl.focus();
    setCursorPos(textEl, cursorPos);
    save();
}

function handleTab(e) {
    e.preventDefault();
    indentItem(e.target);
}

function dedentItem(textEl) {
    checkpoint();
    const item = textEl.closest(".item");
    const parentItem = getParentItem(item);
    if (!parentItem) return;
    if (parentItem.classList.contains("zoom-root")) return;
    const cursorPos = getCursorPos(textEl);
    const grandparentContainer = parentItem.parentElement;
    // Move following siblings into this item's children
    const nextSiblings = [];
    let sibling = item.nextElementSibling;
    while (sibling) {
        nextSiblings.push(sibling);
        sibling = sibling.nextElementSibling;
    }
    const childrenEl = getChildrenEl(item);
    for (const s of nextSiblings)
        childrenEl.appendChild(s);
    grandparentContainer.insertBefore(item, parentItem.nextSibling);
    updateToggle(parentItem);
    updateToggle(item);
    textEl.focus();
    setCursorPos(textEl, cursorPos);
    save();
}

function deleteItem(textEl) {
    checkpoint();
    const item = textEl.closest(".item");
    const visibleItems = getVisibleItems();
    const idx = visibleItems.indexOf(item);
    const prevItem = visibleItems[idx - 1];
    const nextItem = visibleItems[idx + 1];
    const parentItem = getParentItem(item);
    item.remove();
    if (parentItem) updateToggle(parentItem);
    focusAfterRemoval(prevItem, nextItem);
    save();
}

function handleShiftTab(e) {
    e.preventDefault();
    dedentItem(e.target);
}

function handleArrowUp(e) {
    e.preventDefault();
    const textEl = e.target;
    const cursorPos = getCursorPos(textEl);
    const visibleItems = getVisibleItems();
    const idx = visibleItems.indexOf(textEl.closest(".item"));
    if (idx > 0) {
        const prevTextEl = getTextEl(visibleItems[idx - 1]);
        prevTextEl.focus();
        setCursorPos(prevTextEl, Math.min(cursorPos, prevTextEl.textContent.length));
    }
}

function handleArrowDown(e) {
    e.preventDefault();
    const textEl = e.target;
    const cursorPos = getCursorPos(textEl);
    const visibleItems = getVisibleItems();
    const idx = visibleItems.indexOf(textEl.closest(".item"));
    if (idx < visibleItems.length - 1) {
        const nextTextEl = getTextEl(visibleItems[idx + 1]);
        nextTextEl.focus();
        setCursorPos(nextTextEl, Math.min(cursorPos, nextTextEl.textContent.length));
    }
}

function toggleCollapse(item) {
    if (!hasChildren(item)) return;
    checkpoint();
    item.classList.toggle("collapsed");
    updateToggle(item);
    save();
}

function detectIndentUnit(lines) {
    let min = Infinity;
    for (const line of lines) {
        const raw = line.replace(/\t/g, "    ");
        const ws = raw.match(/^(\s*)/)[1].length;
        if (ws > 0 && ws < min) min = ws;
    }
    return min === Infinity ? 4 : min;
}

function parseLine(line, indentUnit) {
    const normalized = line.replace(/\t/g, "    ");
    const m = normalized.match(/^(\s*)([-*•]\s+)?(.*)/);
    const level = indentUnit > 0 ? Math.floor(m[1].length / indentUnit) : 0;
    const text = (m[3] || "").trim();
    return { level, text };
}

function handlePaste(e) {
    e.preventDefault();
    checkpoint();
    const text = e.clipboardData.getData("text/plain");
    const lines = text.split("\n").filter(l => l.trim() !== "");
    const textEl = e.target;
    const pos = getCursorPos(textEl);
    const content = textEl.textContent;
    if (lines.length <= 1) {
        textEl.textContent = content.slice(0, pos) + text + content.slice(pos);
        setCursorPos(textEl, pos + text.length);
    } else {
        const before = content.slice(0, pos);
        const after = content.slice(pos);
        const indentUnit = detectIndentUnit(lines);
        const parsed = lines.map(l => parseLine(l, indentUnit));
        const baseLevel = parsed[0].level;
        for (const p of parsed) p.level -= baseLevel;
        for (let i = 1; i < parsed.length; i++)
            parsed[i].level = Math.min(parsed[i].level, parsed[i - 1].level + 1);
        for (const p of parsed) p.level = Math.max(0, p.level);
        textEl.textContent = before + parsed[0].text;
        const item = textEl.closest(".item");
        const itemAtLevel = [item];
        let lastItem = item;
        const parent = item.parentElement;
        const ref = item.nextSibling;
        for (let i = 1; i < parsed.length; i++) {
            const { level, text: lineText } = parsed[i];
            const newItem = createItem(lineText);
            if (level === 0) {
                parent.insertBefore(newItem, ref);
            } else {
                const parentItem = itemAtLevel[level - 1];
                getChildrenEl(parentItem).appendChild(newItem);
                updateToggle(parentItem);
            }
            itemAtLevel[level] = newItem;
            itemAtLevel.length = level + 1;
            lastItem = newItem;
        }
        const lastTextEl = getTextEl(lastItem);
        const lastText = lastTextEl.textContent;
        lastTextEl.textContent = lastText + after;
        setCursorPos(lastTextEl, lastText.length);
    }
    save();
}

function findDropTarget(y) {
    for (const item of getVisibleItems()) {
        if (item === dragState.item || dragState.item.contains(item)) continue;
        const row = item.querySelector(":scope > .row");
        const rect = row.getBoundingClientRect();
        if (y < rect.top || y > rect.bottom) continue;
        const quarter = rect.height / 4;
        if (hasChildren(item) && !item.classList.contains("collapsed") && y > rect.bottom - quarter) {
            return { referenceItem: item, position: "child" };
        }
        if (y < rect.top + rect.height / 2) {
            return { referenceItem: item, position: "before" };
        }
        return { referenceItem: item, position: "after" };
    }
    return null;
}

function showDropIndicator(indicator, target) {
    const row = target.referenceItem.querySelector(":scope > .row");
    const rect = row.getBoundingClientRect();
    let top;
    let left;
    if (target.position === "before") {
        top = rect.top;
        left = rect.left;
    } else if (target.position === "after") {
        top = rect.bottom;
        left = rect.left;
    } else {
        // "child" — indent one level deeper
        top = rect.bottom;
        const childrenEl = getChildrenEl(target.referenceItem);
        const childrenRect = childrenEl.getBoundingClientRect();
        left = childrenRect.left;
    }
    indicator.style.top = `${top + window.scrollY}px`;
    indicator.style.left = `${left}px`;
    indicator.style.width = `${rect.right - left}px`;
    indicator.style.display = "block";
}

function hideDropIndicator(indicator) {
    indicator.style.display = "none";
}

function performDrop(draggedItem, target) {
    checkpoint();
    const ref = target.referenceItem;
    if (target.position === "before") {
        ref.parentElement.insertBefore(draggedItem, ref);
    } else if (target.position === "after") {
        ref.parentElement.insertBefore(draggedItem, ref.nextSibling);
    } else {
        const childrenEl = getChildrenEl(ref);
        childrenEl.insertBefore(draggedItem, childrenEl.firstChild);
    }
    // Update toggles on old and new parents
    const allItems = document.querySelectorAll("#outline .item");
    for (const item of allItems)
        updateToggle(item);
    save();
}

function setupEvents() {
    setupOutlineEvents();
    setupShortcuts();
    setupBreadcrumbEvents();
    setupDragEvents();
    window.addEventListener("hashchange", () => {
        const hash = location.hash.slice(1);
        const id = hash || "root";
        if ((id === "root" && !zoomedId) || id === zoomedId) return;
        zoomTo(id);
    });
}

function setupOutlineEvents() {
    const outline = document.getElementById("outline");
    outline.addEventListener("keydown", e => {
        // Shift+Arrow for multi-select (works even without text focus)
        if (e.key === "ArrowDown" && e.shiftKey) {
            extendSelection(e, 1);
            return;
        }
        if (e.key === "ArrowUp" && e.shiftKey) {
            extendSelection(e, -1);
            return;
        }
        // Multi-select batch operations
        if (selectedItems.length > 0) {
            if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                handleTabMulti();
                return;
            }
            if (e.key === "Tab" && e.shiftKey) {
                e.preventDefault();
                handleShiftTabMulti();
                return;
            }
            if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                handleDeleteMulti();
                return;
            }
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                toggleCompleteMulti();
                return;
            }
            // Match both Ctrl+C and Ctrl+Shift+C (copy as text). Stop
            // propagation so the document-level Ctrl+Shift+C handler
            // doesn't copy and notify a second time.
            if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();
                copyAsText(getSelectionRoots());
                return;
            }
            if (e.key === "x" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                copyAsText(getSelectionRoots(), "Cut");
                handleDeleteMulti();
                return;
            }
            // Modifier keys alone don't clear selection
            if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
            // Any other key clears selection and falls through
            clearSelection();
        }
        // Single-item handlers
        if (!e.target.classList.contains("text")) return;
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const item = e.target.closest(".item");
            toggleComplete(item);
            return;
        }
        if (e.key === "Enter") {
            handleEnter(e);
        } else if (e.key === "Backspace" && e.shiftKey && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            deleteItem(e.target);
        } else if (e.key === "Backspace") {
            handleBackspace(e);
        } else if (e.key === "Delete") {
            handleDelete(e);
        } else if (e.key === "Tab" && !e.shiftKey) {
            handleTab(e);
        } else if (e.key === "Tab" && e.shiftKey) {
            handleShiftTab(e);
        } else if (e.key === "ArrowUp") {
            handleArrowUp(e);
        } else if (e.key === "ArrowDown") {
            handleArrowDown(e);
        }
    });
    outline.addEventListener("input", e => {
        if (!e.target.classList.contains("text")) return;
        if (zoomedId) applyZoom();
        save();
    });
    outline.addEventListener("mousedown", e => {
        if (e.target.tagName === "A" && e.target.closest(".text")) {
            e.preventDefault();
            e.stopPropagation();
            window.open(e.target.href, "_blank", "noopener");
            return;
        }
        if (e.target.classList.contains("bullet") && e.button === 0) {
            const item = e.target.closest(".item");
            dragState = { item, startX: e.clientX, startY: e.clientY, isDragging: false };
        } else if (e.target.classList.contains("text") && e.button === 0) {
            textDragState = { startItem: e.target.closest(".item"), active: false };
        }
    });
    outline.addEventListener("focusin", e => {
        if (!e.target.classList.contains("text")) return;
        if (suppressSelectionClear) {
            suppressSelectionClear = false;
        } else if (selectedItems.length > 0) {
            clearSelection();
        }
        stripLinks(e.target);
        const item = e.target.closest(".item");
        setFocusedItem(item);
        focusEntry = {
            itemId: item.dataset.id,
            text: e.target.textContent,
            state: captureState(),
        };
    });
    outline.addEventListener("focusout", e => {
        if (!e.target.classList.contains("text")) return;
        const nextTarget = e.relatedTarget;
        if (!nextTarget || !outline.contains(nextTarget))
            setFocusedItem(null);
        commitTextEdit();
        renderLinks(e.target);
    });
    outline.addEventListener("click", e => {
        if (dragDidDrop) {
            dragDidDrop = false;
            return;
        }
        if (selectedItems.length > 0) {
            clearSelection();
        }
        if (e.target.classList.contains("toggle")) {
            const item = e.target.closest(".item");
            toggleCollapse(item);
        } else if (e.target.classList.contains("row")) {
            const textEl = e.target.querySelector(".text");
            if (textEl && window.getSelection().isCollapsed) {
                textEl.focus();
                const sel = window.getSelection();
                sel.selectAllChildren(textEl);
                sel.collapseToEnd();
            }
        } else if (e.target.classList.contains("bullet")) {
            zoomIntoItem(e.target.closest(".item"));
        }
    });
    outline.addEventListener("paste", e => {
        if (!e.target.classList.contains("text")) return;
        handlePaste(e);
    });
    outline.addEventListener("beforeinput", e => {
        if (e.inputType === "historyUndo" || e.inputType === "historyRedo")
            e.preventDefault();
    });
}

// Shortcuts that work regardless of where the caret is.
function setupShortcuts() {
    document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
            if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); redo(); return; }
            if (e.key === "C" && e.shiftKey) {
                e.preventDefault();
                copySelectionOrFocused();
                return;
            }
        }
        if (e.key === "Escape") {
            if (selectedItems.length > 0) {
                e.preventDefault();
                clearSelection();
                return;
            }
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
            const key = e.key.toLowerCase();
            const textEl = getFocusedText();
            if (key === "c" && textEl) {
                e.preventDefault();
                applyColor(textEl.closest(".item"), null);
                return;
            }
            if (COLOR_SHORTCUTS[key] && textEl) {
                e.preventDefault();
                const item = textEl.closest(".item");
                const current = COLOR_SHORTCUTS[key];
                applyColor(item, item.dataset.color === current ? null : current);
            }
        }
    });
}

function setupBreadcrumbEvents() {
    const breadcrumbs = document.getElementById("breadcrumbs");
    // Keep the caret in place when clicking around the breadcrumbs.
    breadcrumbs.addEventListener("mousedown", e => {
        if (e.target.closest(".breadcrumb-menu")) e.preventDefault();
    });
    breadcrumbs.addEventListener("click", e => {
        const crumbItem = e.target.closest(".breadcrumb");
        if (crumbItem) return zoomTo(crumbItem.dataset.id);
        const toggle = e.target.closest(".breadcrumb-toggle");
        if (toggle) {
            const popover = toggle.nextElementSibling;
            const visible = popover.classList.contains("visible");
            dismissBreadcrumbMenus();
            popover.classList.toggle("visible", !visible);
            return;
        }
        const row = e.target.closest(".breadcrumb-row");
        if (row && row.dataset.id) zoomTo(row.dataset.id);
    });
    document.addEventListener("mousedown", e => {
        if (!e.target.closest(".breadcrumb-menu")) dismissBreadcrumbMenus();
    });
}

// Dragging a bullet moves it and its subtree, dragging across text
// selects whole bullets rather than characters.
function setupDragEvents() {
    const dragIndicator = document.createElement("div");
    dragIndicator.className = "drag-indicator";
    document.body.appendChild(dragIndicator);
    document.addEventListener("mousemove", e => {
        if (textDragState) {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const currentItem = el && el.closest(".item");
            if (!currentItem) return;
            if (!textDragState.active && currentItem !== textDragState.startItem) {
                window.getSelection().removeAllRanges();
                document.body.style.userSelect = "none";
                textDragState.active = true;
            }
            if (textDragState.active) {
                const visibleItems = getVisibleItems();
                const a = visibleItems.indexOf(textDragState.startItem);
                const b = visibleItems.indexOf(currentItem);
                if (a === -1 || b === -1) return;
                const range = visibleItems.slice(Math.min(a, b), Math.max(a, b) + 1);
                setSelection(range);
                selectionAnchor = textDragState.startItem;
            }
            return;
        }
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (!dragState.isDragging) {
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            dragState.isDragging = true;
            dragState.item.classList.add("dragging");
            document.body.style.cursor = "grabbing";
            document.body.style.userSelect = "none";
        }
        const target = findDropTarget(e.clientY);
        if (target) {
            showDropIndicator(dragIndicator, target);
        } else {
            hideDropIndicator(dragIndicator);
        }
    });
    document.addEventListener("mouseup", e => {
        if (textDragState) {
            if (textDragState.active) {
                document.body.style.userSelect = "";
                dragDidDrop = true;
            }
            textDragState = null;
            return;
        }
        if (!dragState) return;
        if (dragState.isDragging) {
            e.preventDefault();
            dragState.item.classList.remove("dragging");
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            hideDropIndicator(dragIndicator);
            const target = findDropTarget(e.clientY);
            if (target) {
                const oldParent = getParentItem(dragState.item);
                performDrop(dragState.item, target);
                if (oldParent) updateToggle(oldParent);
            }
            dragDidDrop = true;
        }
        dragState = null;
    });
}

function storageKey(name) {
    return `tinynotes_u${ACCOUNT}_${name}`;
}

function getRedirectUri() {
    return location.origin + location.pathname;
}

function getLoginUrl() {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: COGNITO_CLIENT_ID,
        redirect_uri: getRedirectUri(),
        scope: "openid email",
        state: ACCOUNT,
    });
    return `https://${COGNITO_DOMAIN}/oauth2/authorize?${params}`;
}

function getLogoutUrl() {
    const params = new URLSearchParams({
        client_id: COGNITO_CLIENT_ID,
        logout_uri: getRedirectUri(),
    });
    return `https://${COGNITO_DOMAIN}/logout?${params}`;
}

async function handleAuthCallback() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (!code) return;
    const account = params.get("state") || "1";
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: COGNITO_CLIENT_ID,
        redirect_uri: getRedirectUri(),
        code: code,
    });
    const response = await fetch(`https://${COGNITO_DOMAIN}/oauth2/token`, {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: body,
    });
    const tokens = await response.json();
    const key = name => `tinynotes_u${account}_${name}`;
    localStorage.setItem(key("id_token"), tokens.id_token);
    localStorage.setItem(key("access_token"), tokens.access_token);
    localStorage.setItem(key("refresh_token"), tokens.refresh_token);
    const redirect = account === "1" ? location.pathname : `${location.pathname}?u=${account}`;
    window.history.replaceState({}, document.title, redirect);
}

function decodeJwtPayload(token) {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
}

async function refreshTokens() {
    const refreshToken = localStorage.getItem(storageKey("refresh_token"));
    if (!refreshToken) return false;
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: COGNITO_CLIENT_ID,
        refresh_token: refreshToken,
    });
    const response = await fetch(`https://${COGNITO_DOMAIN}/oauth2/token`, {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: body,
    });
    if (!response.ok) return false;
    const tokens = await response.json();
    localStorage.setItem(storageKey("id_token"), tokens.id_token);
    localStorage.setItem(storageKey("access_token"), tokens.access_token);
    return true;
}

async function isAuthenticated() {
    const token = localStorage.getItem(storageKey("id_token"));
    // Refresh proactively 24 hours before expiry to avoid mid-session failures.
    if (token && decodeJwtPayload(token).exp * 1000 > Date.now() + 86400 * 1000) return true;
    return await refreshTokens();
}

function getEmail() {
    if (DEMO) return `demo@${location.hostname}`;
    const token = localStorage.getItem(storageKey("id_token"));
    if (!token) return null;
    return decodeJwtPayload(token).email;
}

function logout() {
    if (DEMO) {
        location.href = location.origin + location.pathname;
        return;
    }
    localStorage.removeItem(storageKey("id_token"));
    localStorage.removeItem(storageKey("access_token"));
    localStorage.removeItem(storageKey("refresh_token"));
    location.href = getLogoutUrl();
}

function createLoginPage() {
    const container = document.createElement("div");
    container.id = "login";
    const link = document.createElement("a");
    link.href = getLoginUrl();
    link.textContent = "Log in";
    container.appendChild(link);
    document.body.appendChild(container);
}

function createAction(name, key, onClick) {
    const action = document.createElement("span");
    action.className = "menu-action";
    action.textContent = name;
    if (key) action.title = key;
    action.addEventListener("click", onClick);
    return action;
}

function createMenu() {
    const isMac = navigator.platform.startsWith("Mac");
    const ctrl = isMac ? "Cmd" : "Ctrl";
    const alt = isMac ? "Opt" : "Alt";
    // Actions grouped into rows, related ones sharing a row.
    const rows = [
        [
            ["Undo", `${ctrl}+Z`, () => undo()],
            ["Redo", `${ctrl}+Shift+Z`, () => redo()],
        ],
        [
            ["Indent", "Tab", textEl => indentItem(textEl)],
            ["Dedent", "Shift+Tab", textEl => dedentItem(textEl)],
        ],
        [
            ["Complete", `${ctrl}+Enter`, textEl => toggleComplete(textEl.closest(".item"))],
            ["Delete", `${ctrl}+Shift+Backspace`, textEl => deleteItem(textEl)],
        ],
        [
            ["Copy as text", `${ctrl}+Shift+C`, () => copySelectionOrFocused()],
        ],
    ];
    const colors = [
        [
            ["Yellow", "yellow", `${alt}+Y`],
            ["Orange", "orange", `${alt}+O`],
            ["Red", "red", `${alt}+R`],
            ["Violet", "violet", `${alt}+V`],
        ],
        [
            ["Blue", "blue", `${alt}+B`],
            ["Green", "green", `${alt}+G`],
            ["Clear", null, `${alt}+C`],
        ],
    ];
    const menu = document.createElement("div");
    menu.id = "menu";
    const syncStatus = document.createElement("span");
    syncStatus.id = "sync-status";
    document.body.appendChild(syncStatus);
    const label = document.createElement("span");
    label.id = "menu-label";
    label.textContent = `${getEmail()} ▼`;
    menu.appendChild(label);
    menu.addEventListener("mousedown", e => e.preventDefault());
    const popover = document.createElement("div");
    popover.id = "menu-popover";
    popover.className = "popover";
    const dismissPopover = () => popover.classList.remove("visible");
    label.addEventListener("click", () => popover.classList.toggle("visible"));
    document.addEventListener("mousedown", e => {
        if (!menu.contains(e.target)) dismissPopover();
    });
    // Only act on the item being edited, dropping the click if focus is elsewhere.
    const activate = action => {
        const textEl = getFocusedText();
        if (!textEl) return;
        dismissPopover();
        action(textEl);
    };
    for (const row of rows) {
        const rowEl = document.createElement("div");
        rowEl.className = "menu-row";
        for (const [name, key, action] of row)
            rowEl.appendChild(createAction(name, key, () => activate(action)));
        popover.appendChild(rowEl);
    }
    const logoutRow = document.createElement("div");
    logoutRow.className = "menu-row";
    logoutRow.appendChild(createAction("Log out", null, () => logout()));
    popover.appendChild(logoutRow);
    const setColor = color => activate(textEl => applyColor(textEl.closest(".item"), color));
    for (const row of colors) {
        const rowEl = document.createElement("div");
        rowEl.className = "menu-colors";
        for (const [name, color, key] of row) {
            const swatch = document.createElement("span");
            swatch.className = color ? `menu-swatch bg-${color}` : "menu-swatch bg-none";
            swatch.title = `${name} (${key})`;
            swatch.addEventListener("click", () => setColor(color));
            rowEl.appendChild(swatch);
        }
        popover.appendChild(rowEl);
    }
    menu.appendChild(popover);
    document.body.appendChild(menu);
    keepMenuVisible(menu);
}

// On iOS Safari position:fixed is resolved against the layout viewport,
// not the visual viewport, so opening the keyboard scrolls #menu off the
// top of the screen. Translate it to follow the visible visual viewport.
function keepMenuVisible(menu) {
    if (!window.visualViewport) return;
    const vv = window.visualViewport;
    const trackViewport = () => {
        menu.style.transform = `translate(${-vv.offsetLeft}px, ${vv.offsetTop}px)`;
    };
    vv.addEventListener("resize", trackViewport);
    vv.addEventListener("scroll", trackViewport);
    trackViewport();
}

// The page ships empty, everything below #menu is built here.
function buildLayout() {
    createMenu();
    const header = document.createElement("div");
    header.id = "header";
    const breadcrumbs = document.createElement("div");
    breadcrumbs.id = "breadcrumbs";
    header.appendChild(breadcrumbs);
    const zoomTitle = document.createElement("h1");
    zoomTitle.id = "zoom-title";
    header.appendChild(zoomTitle);
    document.body.appendChild(header);
    const outline = document.createElement("div");
    outline.id = "outline";
    document.body.appendChild(outline);
    return outline;
}

// Demo mode gets one empty bullet to play with and neither contacts
// the sync server nor touches local storage, here or anywhere else.
function startDemo() {
    const outline = buildLayout();
    const item = createItem("");
    outline.appendChild(item);
    applyZoom();
    setupEvents();
    getTextEl(item).focus();
}

async function start() {
    const outline = buildLayout();
    const remote = await fetchFromRemote();
    // Leave the outline empty and uneditable rather than risk syncing
    // stale notes over newer ones we failed to read.
    if (!remote) return;
    if (remote.items && remote.items.length > 0) {
        deserialize(remote.items, outline);
    } else {
        const item = createItem("");
        outline.appendChild(item);
    }
    localStorage.setItem(storageKey("notes"), JSON.stringify({
        zoomedId: null,
        items: remote.items,
    }));
    const hash = location.hash.slice(1);
    if (hash && getItemEl(hash)) zoomedId = hash;
    applyZoom();
    renderAllLinks();
    setupEvents();
    const visibleItems = getVisibleItems();
    if (visibleItems.length > 0 && !isTouchDevice)
        getTextEl(visibleItems[0]).focus();
}

(async function() {
    if (DEMO) {
        startDemo();
        return;
    }
    const spinner = document.createElement("div");
    spinner.id = "login";
    spinner.innerHTML = '<div class="spinner"><div class="double-bounce1"></div><div class="double-bounce2"></div></div>';
    document.body.appendChild(spinner);
    await handleAuthCallback();
    if (await isAuthenticated()) {
        await start();
        spinner.remove();
    } else {
        spinner.remove();
        createLoginPage();
    }
})();
