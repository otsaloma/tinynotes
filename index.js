// -*- coding: utf-8-unix -*-
/* global atob, crypto, document, fetch, localStorage, location, navigator, Node, window */

const API_URL = "https://q3yno9wuoi.execute-api.eu-north-1.amazonaws.com";
const COGNITO_CLIENT_ID = "30j2jbt002e8c3sh053sq6oa3i";
const COGNITO_DOMAIN = "eu-north-1fmmzfb35t.auth.eu-north-1.amazoncognito.com";
const ACCOUNT = new URLSearchParams(location.search).get("u") || "1";
const DEMO = new URLSearchParams(location.search).has("demo");

const SYNC_DEBOUNCE_MS = 3000;
const UNDO_LIMIT = 100;

const BULLET = "\u2022";
const NBSP = "\u00a0";
const TRIANGLE_DOWN = "\u25bc";
const TRIANGLE_RIGHT = "\u25b6";

let currentVersion = null;
let dragDidDrop = false;
let dragState = null;
let focusEntryItemId = null;
let focusEntryState = null;
let focusEntryText = null;
let focusedItem = null;
let redoStack = [];
let selectedItems = [];
let selectionAnchor = null;
let suppressSelectionClear = false;
let hasUnsyncedChanges = false;
let syncTimeout = null;
let undoStack = [];
let zoomedId = null;

// DOM Helpers

function generateId() {
    return crypto.randomUUID();
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

function getPrevItem(item) {
    let prev = item.previousElementSibling;
    while (prev && !prev.classList.contains("item"))
        prev = prev.previousElementSibling;
    return prev;
}

function getNextItem(item) {
    let next = item.nextElementSibling;
    while (next && !next.classList.contains("item"))
        next = next.nextElementSibling;
    return next;
}

function getParentItem(item) {
    let parent = item.parentElement;
    if (!parent) return null;
    parent = parent.parentElement;
    if (!parent || !parent.classList.contains("item")) return null;
    return parent;
}

function isVisible(el) {
    let node = el;
    while (node && node.id !== "outline") {
        if (node.classList.contains("zoom-hidden")) return false;
        if (node.classList.contains("children") &&
            node.parentElement &&
            node.parentElement.classList.contains("collapsed")) {
            return false;
        }
        if (node.classList.contains("row") &&
            node.parentElement &&
            (node.parentElement.classList.contains("zoom-root") ||
             node.parentElement.classList.contains("zoom-ancestor"))) {
            return false;
        }
        node = node.parentElement;
    }
    return true;
}

function getVisibleItems() {
    const allTexts = document.querySelectorAll("#outline .text");
    const visible = [];
    for (const text of allTexts) {
        if (isVisible(text)) {
            visible.push(text);
        }
    }
    return visible;
}

function updateToggle(item) {
    const toggle = item.querySelector(":scope > .row > .toggle");
    if (hasChildren(item)) {
        toggle.textContent = item.classList.contains("collapsed") ? TRIANGLE_RIGHT : TRIANGLE_DOWN;
    } else {
        toggle.textContent = NBSP;
    }
}

// Multi-Select Helpers

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

function getSiblingItems(container) {
    return Array.from(container.querySelectorAll(":scope > .item"));
}

// Multi-Select Operations

function handleShiftArrowDown(e) {
    e.preventDefault();
    const textEl = document.activeElement;
    const item = textEl.closest ? textEl.closest(".item") : null;
    if (!item) return;
    const container = item.parentElement;
    const siblings = getSiblingItems(container);

    if (selectedItems.length === 0) {
        const idx = siblings.indexOf(item);
        if (idx < siblings.length - 1) {
            selectionAnchor = item;
            setSelection([item, siblings[idx + 1]]);
            window.getSelection().removeAllRanges();
        }
    } else {
        const anchorIdx = siblings.indexOf(selectionAnchor);
        const lastSelected = selectedItems[selectedItems.length - 1];
        const firstSelected = selectedItems[0];
        const lastIdx = siblings.indexOf(lastSelected);
        const firstIdx = siblings.indexOf(firstSelected);

        if (anchorIdx === firstIdx) {
            // Extending downward
            if (lastIdx < siblings.length - 1) {
                setSelection(siblings.slice(firstIdx, lastIdx + 2));
                selectionAnchor = firstSelected;
                window.getSelection().removeAllRanges();
            }
        } else {
            // Contracting from top
            if (selectedItems.length > 2) {
                setSelection(siblings.slice(firstIdx + 1, lastIdx + 1));
                selectionAnchor = lastSelected;
                window.getSelection().removeAllRanges();
            } else {
                clearSelection();
                const textToFocus = getTextEl(siblings[firstIdx + 1]);
                textToFocus.focus();
                setCursorPos(textToFocus, textToFocus.textContent.length);
            }
        }
    }
}

function handleShiftArrowUp(e) {
    e.preventDefault();
    const textEl = document.activeElement;
    const item = textEl.closest ? textEl.closest(".item") : null;
    if (!item) return;
    const container = item.parentElement;
    const siblings = getSiblingItems(container);

    if (selectedItems.length === 0) {
        const idx = siblings.indexOf(item);
        if (idx > 0) {
            selectionAnchor = item;
            setSelection([siblings[idx - 1], item]);
            window.getSelection().removeAllRanges();
        }
    } else {
        const anchorIdx = siblings.indexOf(selectionAnchor);
        const lastSelected = selectedItems[selectedItems.length - 1];
        const firstSelected = selectedItems[0];
        const lastIdx = siblings.indexOf(lastSelected);
        const firstIdx = siblings.indexOf(firstSelected);

        if (anchorIdx === lastIdx) {
            // Extending upward
            if (firstIdx > 0) {
                setSelection(siblings.slice(firstIdx - 1, lastIdx + 1));
                selectionAnchor = lastSelected;
                window.getSelection().removeAllRanges();
            }
        } else {
            // Contracting from bottom
            if (selectedItems.length > 2) {
                setSelection(siblings.slice(firstIdx, lastIdx));
                selectionAnchor = firstSelected;
                window.getSelection().removeAllRanges();
            } else {
                clearSelection();
                const textToFocus = getTextEl(siblings[lastIdx - 1]);
                textToFocus.focus();
                setCursorPos(textToFocus, textToFocus.textContent.length);
            }
        }
    }
}

function handleTabMulti() {
    commitTextCheckpoint();
    pushUndo();
    const firstItem = selectedItems[0];
    const prevItem = getPrevItem(firstItem);
    if (!prevItem || selectedItems.includes(prevItem)) return;
    if (prevItem.classList.contains("collapsed")) {
        prevItem.classList.remove("collapsed");
    }
    const prevChildrenEl = getChildrenEl(prevItem);
    const oldParent = getParentItem(firstItem);
    for (const item of selectedItems)
        prevChildrenEl.appendChild(item);
    updateToggle(prevItem);
    if (oldParent) updateToggle(oldParent);
    save();
}

function handleShiftTabMulti() {
    commitTextCheckpoint();
    pushUndo();
    const firstItem = selectedItems[0];
    const lastItem = selectedItems[selectedItems.length - 1];
    const parentItem = getParentItem(firstItem);
    if (!parentItem) return;
    if (parentItem.classList.contains("zoom-root")) return;
    const grandparentContainer = parentItem.parentElement;
    // Gather following siblings after last selected item
    const followingSiblings = [];
    let sibling = getNextItem(lastItem);
    while (sibling) {
        followingSiblings.push(sibling);
        sibling = getNextItem(sibling);
    }
    // Move following siblings into last selected item's children
    const lastChildrenEl = getChildrenEl(lastItem);
    for (const s of followingSiblings)
        lastChildrenEl.appendChild(s);
    // Move all selected items after parentItem in grandparent
    let insertRef = parentItem.nextSibling;
    for (const item of selectedItems) {
        grandparentContainer.insertBefore(item, insertRef);
        insertRef = item.nextSibling;
    }
    updateToggle(parentItem);
    for (const item of selectedItems)
        updateToggle(item);
    save();
}

function handleDeleteMulti() {
    commitTextCheckpoint();
    pushUndo();
    const firstItem = selectedItems[0];
    const lastItem = selectedItems[selectedItems.length - 1];
    // Find focus target
    let prevSibling = getPrevItem(firstItem);
    while (prevSibling && selectedItems.includes(prevSibling))
        prevSibling = getPrevItem(prevSibling);
    let nextSibling = getNextItem(lastItem);
    while (nextSibling && selectedItems.includes(nextSibling))
        nextSibling = getNextItem(nextSibling);
    const parentItem = getParentItem(firstItem);
    const focusTarget = prevSibling || nextSibling || parentItem;
    // Remove all selected items
    for (const item of selectedItems)
        item.remove();
    clearSelection();
    if (parentItem) updateToggle(parentItem);
    // Handle empty outline
    const outline = document.getElementById("outline");
    if (!outline.querySelector(".item")) {
        const newItem = createItem("");
        outline.appendChild(newItem);
        getTextEl(newItem).focus();
        save();
        return;
    }
    if (focusTarget) {
        suppressSelectionClear = true;
        const textEl = getTextEl(focusTarget);
        textEl.focus();
        setCursorPos(textEl, textEl.textContent.length);
    }
    save();
}

// Color Menu

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
    commitTextCheckpoint();
    pushUndo();
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

function toggleComplete(item) {
    commitTextCheckpoint();
    pushUndo();
    const completing = !item.classList.contains("completed");
    const items = [item, ...item.querySelectorAll(".item")];
    for (const it of items) {
        if (completing) {
            it.classList.add("completed");
            it.dataset.completed = "true";
        } else {
            it.classList.remove("completed");
            delete it.dataset.completed;
        }
    }
    if (completing) {
        const nextSibling = item.nextElementSibling;
        if (nextSibling && nextSibling.classList.contains("item"))
            getTextEl(nextSibling).focus();
    }
    save();
}

function copyItemProperties(from, to) {
    if (from.dataset.color) {
        to.dataset.color = from.dataset.color;
        getTextEl(to).classList.add(`bg-${from.dataset.color}`);
    }
    if (from.classList.contains("completed")) {
        to.classList.add("completed");
        to.dataset.completed = "true";
    }
    if (from.classList.contains("collapsed"))
        to.classList.add("collapsed");
}

function clearItemProperties(item) {
    if (item.dataset.color) {
        getTextEl(item).classList.remove(`bg-${item.dataset.color}`);
        delete item.dataset.color;
    }
    item.classList.remove("completed");
    delete item.dataset.completed;
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

function copyAsText(item) {
    const text = itemToText(item, 0);
    navigator.clipboard.writeText(text);
    notify("Copied 1 bullet");
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

// Link Rendering

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

// Cursor Helpers

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

// Persistence

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
        if (data.completed) {
            item.classList.add("completed");
            item.dataset.completed = "true";
        }
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

// Sync

function updateSyncStatus(state) {
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
        el.textContent = "sync error";
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
            else updateSyncStatus("error");
        } else {
            updateSyncStatus("error");
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
        return null;
    } catch {
        return null;
    }
}

// Undo/Redo

function captureState() {
    const outline = document.getElementById("outline");
    const state = {
        items: serialize(outline),
        zoomedId: zoomedId,
        focusId: null,
        cursorPos: 0,
    };
    const focused = document.activeElement;
    if (focused && focused.classList.contains("text")) {
        state.focusId = focused.closest(".item").dataset.id;
        state.cursorPos = getCursorPos(focused);
    }
    return state;
}

function pushUndo(state) {
    undoStack.push(state || captureState());
    if (undoStack.length > UNDO_LIMIT)
        undoStack.splice(0, undoStack.length - UNDO_LIMIT);
    redoStack = [];
}

function commitTextCheckpoint() {
    if (!focusEntryState) return false;
    const item = focusEntryItemId ? getItemEl(focusEntryItemId) : null;
    const currentText = item ? getTextEl(item).textContent : null;
    if (currentText !== focusEntryText) {
        undoStack.push(focusEntryState);
        if (undoStack.length > UNDO_LIMIT)
            undoStack.splice(0, undoStack.length - UNDO_LIMIT);
        redoStack = [];
        focusEntryState = null;
        focusEntryText = null;
        focusEntryItemId = null;
        return true;
    }
    focusEntryState = null;
    focusEntryText = null;
    focusEntryItemId = null;
    return false;
}

function restoreState(state) {
    const outline = document.getElementById("outline");
    outline.innerHTML = "";
    deserialize(state.items, outline);
    zoomedId = state.zoomedId || null;
    applyZoom();
    renderAllLinks();
    save();
    focusEntryState = null;
    focusEntryText = null;
    focusEntryItemId = null;
    if (state.focusId) {
        const item = getItemEl(state.focusId);
        if (item) {
            const textEl = getTextEl(item);
            stripLinks(textEl);
            textEl.focus();
            setCursorPos(textEl, state.cursorPos);
            focusEntryState = captureState();
            focusEntryText = textEl.textContent;
            focusEntryItemId = state.focusId;
        }
    }
}

function undo() {
    commitTextCheckpoint();
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

// Zoom

function applyZoom() {
    const outline = document.getElementById("outline");
    const els = outline.querySelectorAll(".zoom-root, .zoom-ancestor, .zoom-hidden");
    for (const el of els)
        el.classList.remove("zoom-root", "zoom-ancestor", "zoom-hidden");
    const breadcrumbs = document.getElementById("breadcrumbs");
    breadcrumbs.innerHTML = "";
    if (!zoomedId) {
        const home = document.createElement("span");
        home.className = "breadcrumb";
        home.dataset.id = "root";
        home.textContent = "Home";
        breadcrumbs.appendChild(home);
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
    // Build breadcrumb
    let crumbs = [{ id: "root", text: "Home" }];
    let node = target;
    const ancestorCrumbs = [];
    while (node) {
        const text = getTextEl(node).textContent || "(empty)";
        ancestorCrumbs.push({ id: node.dataset.id, text: text });
        node = getParentItem(node);
    }
    ancestorCrumbs.reverse();
    crumbs = crumbs.concat(ancestorCrumbs);
    for (let i = 0; i < crumbs.length; i++) {
        if (i > 0) {
            const sep = document.createElement("span");
            sep.className = "breadcrumb-sep";
            sep.innerHTML = " &gt; ";
            breadcrumbs.appendChild(sep);
        }
        const span = document.createElement("span");
        span.className = "breadcrumb";
        span.dataset.id = crumbs[i].id;
        span.textContent = crumbs[i].text;
        breadcrumbs.appendChild(span);
    }
}

function zoomTo(id) {
    commitTextCheckpoint();
    pushUndo();
    zoomedId = id === "root" ? null : id;
    if (zoomedId) {
        const target = getItemEl(zoomedId);
        if (target && target.classList.contains("collapsed")) {
            target.classList.remove("collapsed");
            updateToggle(target);
        }
    }
    applyZoom();
    save();
}

// Structural Operations

function handleEnter(e) {
    e.preventDefault();
    commitTextCheckpoint();
    pushUndo();
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
    const idx = visibleItems.indexOf(textEl);
    const nextTextEl = idx < visibleItems.length - 1 ? visibleItems[idx + 1] : null;
    if (!nextTextEl) return;
    e.preventDefault();
    commitTextCheckpoint();
    pushUndo();
    const parentItem = getParentItem(item);
    item.remove();
    if (parentItem) updateToggle(parentItem);
    nextTextEl.focus();
    setCursorPos(nextTextEl, 0);
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
    commitTextCheckpoint();
    pushUndo();
    const text = textEl.textContent;
    const childrenEl = getChildrenEl(item);
    if (text === "" && !hasChildren(item)) {
        const visibleItems = getVisibleItems();
        const idx = visibleItems.indexOf(textEl);
        const prevTextEl = idx > 0 ? visibleItems[idx - 1] : null;
        const parentItem = getParentItem(item);
        item.remove();
        if (parentItem) updateToggle(parentItem);
        // If outline is now empty, create a starter bullet
        const outline = document.getElementById("outline");
        if (!outline.querySelector(".item")) {
            const newItem = createItem("");
            outline.appendChild(newItem);
            getTextEl(newItem).focus();
            save();
            return;
        }
        const nextTextEl = idx < visibleItems.length - 1 ? visibleItems[idx + 1] : null;
        if (prevTextEl) {
            prevTextEl.focus();
            setCursorPos(prevTextEl, prevTextEl.textContent.length);
        } else if (nextTextEl) {
            nextTextEl.focus();
            setCursorPos(nextTextEl, 0);
        }
    } else if (text === "" && hasChildren(item)) {
        const parentContainer = item.parentElement;
        const parentItem = getParentItem(item);
        const nextSibling = item.nextSibling;
        const visibleItems = getVisibleItems();
        const children = Array.from(childrenEl.querySelectorAll(":scope > .item"));
        const firstChildText = children.length > 0 ? getTextEl(children[0]) : null;
        const idx = firstChildText ? visibleItems.indexOf(firstChildText) : -1;
        const prevTextEl = idx > 0 ? visibleItems[idx - 1] : null;
        for (const child of children)
            parentContainer.insertBefore(child, nextSibling);
        item.remove();
        if (parentItem) updateToggle(parentItem);
        if (prevTextEl) {
            prevTextEl.focus();
            setCursorPos(prevTextEl, prevTextEl.textContent.length);
        }
    } else {
        const visibleItems = getVisibleItems();
        const idx = visibleItems.indexOf(textEl);
        if (idx <= 0) return;
        const prevTextEl = visibleItems[idx - 1];
        const prevItem = prevTextEl.closest(".item");
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
    commitTextCheckpoint();
    pushUndo();
    const item = textEl.closest(".item");
    const prevItem = getPrevItem(item);
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
    commitTextCheckpoint();
    pushUndo();
    const item = textEl.closest(".item");
    const parentItem = getParentItem(item);
    if (!parentItem) return;
    if (parentItem.classList.contains("zoom-root")) return;
    const cursorPos = getCursorPos(textEl);
    const grandparentContainer = parentItem.parentElement;
    // Move following siblings into this item's children
    const nextSiblings = [];
    let sibling = getNextItem(item);
    while (sibling) {
        nextSiblings.push(sibling);
        sibling = getNextItem(sibling);
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
    commitTextCheckpoint();
    pushUndo();
    const item = textEl.closest(".item");
    const visibleItems = getVisibleItems();
    const idx = visibleItems.indexOf(textEl);
    const prevTextEl = idx > 0 ? visibleItems[idx - 1] : null;
    const parentItem = getParentItem(item);
    item.remove();
    if (parentItem) updateToggle(parentItem);
    const outline = document.getElementById("outline");
    if (!outline.querySelector(".item")) {
        const newItem = createItem("");
        outline.appendChild(newItem);
        getTextEl(newItem).focus();
    } else if (prevTextEl) {
        prevTextEl.focus();
        setCursorPos(prevTextEl, prevTextEl.textContent.length);
    } else {
        const nextTextEl = idx < visibleItems.length - 1 ? visibleItems[idx + 1] : null;
        if (nextTextEl) {
            nextTextEl.focus();
            setCursorPos(nextTextEl, 0);
        }
    }
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
    const idx = visibleItems.indexOf(textEl);
    if (idx > 0) {
        const prevTextEl = visibleItems[idx - 1];
        prevTextEl.focus();
        setCursorPos(prevTextEl, Math.min(cursorPos, prevTextEl.textContent.length));
    }
}

function handleArrowDown(e) {
    e.preventDefault();
    const textEl = e.target;
    const cursorPos = getCursorPos(textEl);
    const visibleItems = getVisibleItems();
    const idx = visibleItems.indexOf(textEl);
    if (idx < visibleItems.length - 1) {
        const nextTextEl = visibleItems[idx + 1];
        nextTextEl.focus();
        setCursorPos(nextTextEl, Math.min(cursorPos, nextTextEl.textContent.length));
    }
}

// Collapse/Expand

function toggleCollapse(item) {
    if (!hasChildren(item)) return;
    commitTextCheckpoint();
    pushUndo();
    item.classList.toggle("collapsed");
    updateToggle(item);
    save();
}

// Paste Handling

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
    commitTextCheckpoint();
    pushUndo();
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

// Drag and Drop

function findDropTarget(y) {
    const visibleItems = getVisibleItems();
    for (const textEl of visibleItems) {
        const item = textEl.closest(".item");
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
    commitTextCheckpoint();
    pushUndo();
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

// Event Handling

function setupEvents() {
    const outline = document.getElementById("outline");
    outline.addEventListener("keydown", e => {
        // Shift+Arrow for multi-select (works even without text focus)
        if (e.key === "ArrowDown" && e.shiftKey) {
            handleShiftArrowDown(e);
            return;
        }
        if (e.key === "ArrowUp" && e.shiftKey) {
            handleShiftArrowUp(e);
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
                commitTextCheckpoint();
                pushUndo();
                const completing = selectedItems.some(it => !it.classList.contains("completed"));
                for (const it of selectedItems) {
                    const items = [it, ...it.querySelectorAll(".item")];
                    for (const desc of items) {
                        if (completing) {
                            desc.classList.add("completed");
                            desc.dataset.completed = "true";
                        } else {
                            desc.classList.remove("completed");
                            delete desc.dataset.completed;
                        }
                    }
                }
                save();
                return;
            }
            // Match both Ctrl+C and Ctrl+Shift+C (copy as text)
            if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const text = selectedItems.map(it => itemToText(it, 0)).join("");
                navigator.clipboard.writeText(text);
                notify(`Copied ${selectedItems.length} bullets`);
                return;
            }
            if (e.key === "x" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const text = selectedItems.map(it => itemToText(it, 0)).join("");
                navigator.clipboard.writeText(text);
                notify(`Cut ${selectedItems.length} bullets`);
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
        focusEntryItemId = item.dataset.id;
        focusEntryText = e.target.textContent;
        focusEntryState = captureState();
    });
    outline.addEventListener("focusout", e => {
        if (!e.target.classList.contains("text")) return;
        const nextTarget = e.relatedTarget;
        if (!nextTarget || !outline.contains(nextTarget))
            setFocusedItem(null);
        commitTextCheckpoint();
        renderLinks(e.target);
    });
    document.addEventListener("selectionchange", () => {
        const sel = document.getSelection();
        if (sel.anchorNode) {
            const el = sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode;
            const textEl = el && el.closest ? el.closest(".text") : null;
            if (textEl && outline.contains(textEl)) {
                setFocusedItem(textEl.closest(".item"));
                return;
            }
        }
        setFocusedItem(null);
    });
    outline.addEventListener("click", e => {
        // Shift+Click range selection
        if (e.shiftKey && (e.target.classList.contains("text") || e.target.classList.contains("bullet"))) {
            e.preventDefault();
            const clickedItem = e.target.closest(".item");
            if (!clickedItem) return;
            let anchorItem = selectionAnchor;
            if (!anchorItem) {
                const focused = document.activeElement;
                if (focused && focused.classList.contains("text")) {
                    anchorItem = focused.closest(".item");
                }
            }
            if (!anchorItem) return;
            // Must be same parent
            if (anchorItem.parentElement !== clickedItem.parentElement) return;
            const container = anchorItem.parentElement;
            const siblings = getSiblingItems(container);
            const anchorIdx = siblings.indexOf(anchorItem);
            const clickedIdx = siblings.indexOf(clickedItem);
            if (anchorIdx === -1 || clickedIdx === -1) return;
            const start = Math.min(anchorIdx, clickedIdx);
            const end = Math.max(anchorIdx, clickedIdx);
            setSelection(siblings.slice(start, end + 1));
            selectionAnchor = anchorItem;
            window.getSelection().removeAllRanges();
            return;
        }
        // Click without shift clears selection
        if (selectedItems.length > 0 && !e.shiftKey) {
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
            if (dragDidDrop) {
                dragDidDrop = false;
                return;
            }
            const item = e.target.closest(".item");
            zoomTo(item.dataset.id);
            if (!hasChildren(item)) {
                pushUndo();
                const newItem = createItem("");
                getChildrenEl(item).appendChild(newItem);
                updateToggle(item);
                save();
                getTextEl(newItem).focus();
            }
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
    document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
            if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); redo(); return; }
            if (e.key === "C" && e.shiftKey) {
                e.preventDefault();
                if (selectedItems.length > 0) {
                    const text = selectedItems.map(it => itemToText(it, 0)).join("");
                    navigator.clipboard.writeText(text);
                    notify(`Copied ${selectedItems.length} bullets`);
                } else {
                    const focused = document.activeElement;
                    if (focused && focused.classList.contains("text"))
                        copyAsText(focused.closest(".item"));
                }
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
            if (key === "c") {
                const focused = document.activeElement;
                if (focused && focused.classList.contains("text")) {
                    e.preventDefault();
                    applyColor(focused.closest(".item"), null);
                }
                return;
            }
            if (COLOR_SHORTCUTS[key]) {
                const focused = document.activeElement;
                if (focused && focused.classList.contains("text")) {
                    e.preventDefault();
                    const item = focused.closest(".item");
                    const current = COLOR_SHORTCUTS[key];
                    applyColor(item, item.dataset.color === current ? null : current);
                }
            }
        }
    });
    const breadcrumbs = document.getElementById("breadcrumbs");
    breadcrumbs.addEventListener("click", e => {
        const crumbItem = e.target.closest(".breadcrumb");
        if (!crumbItem) return;
        zoomTo(crumbItem.dataset.id);
    });
    const dragIndicator = document.createElement("div");
    dragIndicator.className = "drag-indicator";
    document.body.appendChild(dragIndicator);
    document.addEventListener("mousemove", e => {
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

// Storage

function storageKey(name) {
    return `tinynotes_u${ACCOUNT}_${name}`;
}

// TODO: Remove migrateStorageKeys after all devices have been migrated
function migrateStorageKeys() {
    if (!localStorage.getItem("tinynotes_id_token")) return;
    for (const name of ["id_token", "access_token", "refresh_token", "notes"])
        localStorage.setItem(storageKey(name), localStorage.getItem(`tinynotes_${name}`));
    for (const name of ["id_token", "access_token", "refresh_token", "notes"])
        localStorage.removeItem(`tinynotes_${name}`);
}

// Auth

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
    if (token && decodeJwtPayload(token).exp * 1000 > Date.now()) return true;
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

// Main

function createMenu() {
    const isMac = navigator.platform.startsWith("Mac");
    const ctrl = isMac ? "Cmd" : "Ctrl";
    const alt = isMac ? "Opt" : "Alt";
    const shortcuts = [
        [`${ctrl}+Z`, "Undo", () => undo()],
        [`${ctrl}+Shift+Z`, "Redo", () => redo()],
        "---",
        ["Tab", "Indent", textEl => indentItem(textEl)],
        ["Shift+Tab", "Dedent", textEl => dedentItem(textEl)],
        [`${ctrl}+Enter`, "Complete", textEl => toggleComplete(textEl.closest(".item"))],
        [`${ctrl}+Shift+Backspace`, "Delete", textEl => deleteItem(textEl)],
        [`${ctrl}+Shift+C`, "Copy As Text", textEl => {
            if (selectedItems.length > 0) {
                const text = selectedItems.map(it => itemToText(it, 0)).join("");
                navigator.clipboard.writeText(text);
                notify(`Copied ${selectedItems.length} bullets`);
            } else {
                copyAsText(textEl.closest(".item"));
            }
        }],
        ["Shift+Up/Down", "Multi-Select"],
        "---",
        [`${alt}+Y`, "Background Yellow", textEl => applyColor(textEl.closest(".item"), "yellow")],
        [`${alt}+O`, "Background Orange", textEl => applyColor(textEl.closest(".item"), "orange")],
        [`${alt}+R`, "Background Red", textEl => applyColor(textEl.closest(".item"), "red")],
        [`${alt}+V`, "Background Violet", textEl => applyColor(textEl.closest(".item"), "violet")],
        [`${alt}+B`, "Background Blue", textEl => applyColor(textEl.closest(".item"), "blue")],
        [`${alt}+G`, "Background Green", textEl => applyColor(textEl.closest(".item"), "green")],
        [`${alt}+C`, "Background Clear", textEl => applyColor(textEl.closest(".item"), null)],
    ];
    const menu = document.createElement("div");
    menu.id = "menu";
    const syncStatus = document.createElement("span");
    syncStatus.id = "sync-status";
    document.body.appendChild(syncStatus);
    const label = document.createElement("span");
    label.id = "menu-label";
    label.textContent = `${getEmail()} ${TRIANGLE_DOWN}`;
    menu.appendChild(label);
    menu.addEventListener("mousedown", e => e.preventDefault());
    const popover = document.createElement("div");
    popover.id = "menu-popover";
    const dismissPopover = () => popover.classList.remove("visible");
    label.addEventListener("click", () => popover.classList.toggle("visible"));
    document.addEventListener("mousedown", e => {
        if (!menu.contains(e.target)) dismissPopover();
    });
    for (const entry of shortcuts) {
        if (entry === "---") {
            const hr = document.createElement("hr");
            hr.className = "menu-separator";
            popover.appendChild(hr);
            continue;
        }
        const [key, desc, action] = entry;
        const row = document.createElement("div");
        row.className = "menu-row";
        if (action) {
            row.classList.add("menu-action");
            row.addEventListener("click", () => {
                const active = document.activeElement;
                if (!active || !active.classList.contains("text")) return;
                dismissPopover();
                action(active);
            });
        }
        const descEl = document.createElement("span");
        descEl.textContent = desc;
        const keyEl = document.createElement("span");
        keyEl.className = "menu-key";
        const parts = key.split("+");
        for (let i = 0; i < parts.length; i++) {
            const kbd = document.createElement("kbd");
            kbd.textContent = parts[i];
            keyEl.appendChild(kbd);
        }
        row.appendChild(descEl);
        row.appendChild(keyEl);
        popover.appendChild(row);
    }
    const logoutSep = document.createElement("hr");
    logoutSep.className = "menu-separator";
    popover.appendChild(logoutSep);
    const logoutRow = document.createElement("div");
    logoutRow.className = "menu-row menu-action";
    const logoutDesc = document.createElement("span");
    logoutDesc.textContent = "Log out";
    logoutRow.appendChild(logoutDesc);
    logoutRow.addEventListener("click", () => logout());
    popover.appendChild(logoutRow);
    menu.appendChild(popover);
    document.body.appendChild(menu);
}

async function main() {
    createMenu();
    const breadcrumbs = document.createElement("div");
    breadcrumbs.id = "breadcrumbs";
    document.body.appendChild(breadcrumbs);
    const outline = document.createElement("div");
    outline.id = "outline";
    document.body.appendChild(outline);
    const remote = await fetchFromRemote();
    if (!remote) {
        updateSyncStatus("error");
        return;
    }
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
    applyZoom();
    renderAllLinks();
    setupEvents();
    const visibleItems = getVisibleItems();
    if (visibleItems.length > 0) {
        visibleItems[0].focus();
    }
}

(async function() {
    if (DEMO) {
        createMenu();
        const breadcrumbs = document.createElement("div");
        breadcrumbs.id = "breadcrumbs";
        document.body.appendChild(breadcrumbs);
        const outline = document.createElement("div");
        outline.id = "outline";
        document.body.appendChild(outline);
        const item = createItem("");
        outline.appendChild(item);
        applyZoom();
        setupEvents();
        getTextEl(item).focus();
        return;
    }
    const spinner = document.createElement("div");
    spinner.id = "login";
    spinner.innerHTML = '<div class="spinner"><div class="double-bounce1"></div><div class="double-bounce2"></div></div>';
    document.body.appendChild(spinner);
    if (ACCOUNT === "1") migrateStorageKeys();
    await handleAuthCallback();
    if (await isAuthenticated()) {
        await main();
        spinner.remove();
    } else {
        spinner.remove();
        createLoginPage();
    }
})();
