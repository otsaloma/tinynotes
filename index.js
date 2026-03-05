// -*- coding: utf-8-unix -*-
/* global crypto, document, localStorage, window */

let zoomedId = null;
let selectedItems = [];
let selectionAnchor = null;
let suppressSelectionClear = false;

// DOM Helpers

function generateId() {
    return crypto.randomUUID();
}

function createItem(text) {
    let item = document.createElement("div");
    item.className = "item";
    item.dataset.id = generateId();
    let row = document.createElement("div");
    row.className = "row";
    let toggle = document.createElement("span");
    toggle.className = "toggle";
    toggle.textContent = "\u00a0";
    let bullet = document.createElement("span");
    bullet.className = "bullet";
    bullet.textContent = "\u2022";
    let textEl = document.createElement("div");
    textEl.className = "text";
    textEl.contentEditable = "true";
    textEl.textContent = text || "";
    row.appendChild(toggle);
    row.appendChild(bullet);
    row.appendChild(textEl);
    item.appendChild(row);
    let children = document.createElement("div");
    children.className = "children";
    item.appendChild(children);
    return item;
}

function getItemEl(id) {
    return document.querySelector(".item[data-id=\"" + id + "\"]");
}

function getTextEl(item) {
    return item.querySelector(":scope > .row > .text");
}

function getChildrenEl(item) {
    return item.querySelector(":scope > .children");
}

function hasChildren(item) {
    return getChildrenEl(item).querySelector(":scope > .item") !== null;
}

function getPrevItem(item) {
    let prev = item.previousElementSibling;
    while (prev && !prev.classList.contains("item")) {
        prev = prev.previousElementSibling;
    }
    return prev;
}

function getNextItem(item) {
    let next = item.nextElementSibling;
    while (next && !next.classList.contains("item")) {
        next = next.nextElementSibling;
    }
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
    let allTexts = document.querySelectorAll("#outline .text");
    let visible = [];
    for (let text of allTexts) {
        if (isVisible(text)) {
            visible.push(text);
        }
    }
    return visible;
}

function updateToggle(item) {
    let toggle = item.querySelector(":scope > .row > .toggle");
    if (hasChildren(item)) {
        toggle.textContent = item.classList.contains("collapsed") ? "\u25b6" : "\u25bc";
    } else {
        toggle.textContent = "\u00a0";
    }
}

// Multi-Select Helpers

function clearSelection() {
    for (let item of selectedItems) {
        item.classList.remove("selected");
    }
    selectedItems = [];
    selectionAnchor = null;
}

function setSelection(items) {
    for (let item of selectedItems) {
        item.classList.remove("selected");
    }
    selectedItems = items;
    for (let item of items) {
        item.classList.add("selected");
    }
}

function getSiblingItems(container) {
    return Array.from(container.querySelectorAll(":scope > .item"));
}

// Multi-Select Operations

function handleShiftArrowDown(e) {
    e.preventDefault();
    let textEl = document.activeElement;
    let item = textEl.closest ? textEl.closest(".item") : null;
    if (!item) return;
    let container = item.parentElement;
    let siblings = getSiblingItems(container);

    if (selectedItems.length === 0) {
        let idx = siblings.indexOf(item);
        if (idx < siblings.length - 1) {
            selectionAnchor = item;
            setSelection([item, siblings[idx + 1]]);
            window.getSelection().removeAllRanges();
        }
    } else {
        let anchorIdx = siblings.indexOf(selectionAnchor);
        let lastSelected = selectedItems[selectedItems.length - 1];
        let firstSelected = selectedItems[0];
        let lastIdx = siblings.indexOf(lastSelected);
        let firstIdx = siblings.indexOf(firstSelected);

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
                let textToFocus = getTextEl(siblings[firstIdx + 1]);
                textToFocus.focus();
                setCursorPos(textToFocus, textToFocus.textContent.length);
            }
        }
    }
}

function handleShiftArrowUp(e) {
    e.preventDefault();
    let textEl = document.activeElement;
    let item = textEl.closest ? textEl.closest(".item") : null;
    if (!item) return;
    let container = item.parentElement;
    let siblings = getSiblingItems(container);

    if (selectedItems.length === 0) {
        let idx = siblings.indexOf(item);
        if (idx > 0) {
            selectionAnchor = item;
            setSelection([siblings[idx - 1], item]);
            window.getSelection().removeAllRanges();
        }
    } else {
        let anchorIdx = siblings.indexOf(selectionAnchor);
        let lastSelected = selectedItems[selectedItems.length - 1];
        let firstSelected = selectedItems[0];
        let lastIdx = siblings.indexOf(lastSelected);
        let firstIdx = siblings.indexOf(firstSelected);

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
                let textToFocus = getTextEl(siblings[lastIdx - 1]);
                textToFocus.focus();
                setCursorPos(textToFocus, textToFocus.textContent.length);
            }
        }
    }
}

function handleTabMulti() {
    let firstItem = selectedItems[0];
    let prevItem = getPrevItem(firstItem);
    if (!prevItem || selectedItems.includes(prevItem)) return;
    if (prevItem.classList.contains("collapsed")) {
        prevItem.classList.remove("collapsed");
    }
    let prevChildrenEl = getChildrenEl(prevItem);
    let oldParent = getParentItem(firstItem);
    for (let item of selectedItems) {
        prevChildrenEl.appendChild(item);
    }
    updateToggle(prevItem);
    if (oldParent) updateToggle(oldParent);
    save();
}

function handleShiftTabMulti() {
    let firstItem = selectedItems[0];
    let lastItem = selectedItems[selectedItems.length - 1];
    let parentItem = getParentItem(firstItem);
    if (!parentItem) return;
    if (parentItem.classList.contains("zoom-root")) return;
    let grandparentContainer = parentItem.parentElement;
    // Gather following siblings after last selected item
    let followingSiblings = [];
    let sibling = getNextItem(lastItem);
    while (sibling) {
        followingSiblings.push(sibling);
        sibling = getNextItem(sibling);
    }
    // Move following siblings into last selected item's children
    let lastChildrenEl = getChildrenEl(lastItem);
    for (let s of followingSiblings) {
        lastChildrenEl.appendChild(s);
    }
    // Move all selected items after parentItem in grandparent
    let insertRef = parentItem.nextSibling;
    for (let item of selectedItems) {
        grandparentContainer.insertBefore(item, insertRef);
        insertRef = item.nextSibling;
    }
    updateToggle(parentItem);
    for (let item of selectedItems) {
        updateToggle(item);
    }
    save();
}

function handleDeleteMulti() {
    let firstItem = selectedItems[0];
    let lastItem = selectedItems[selectedItems.length - 1];
    let container = firstItem.parentElement;
    // Find focus target
    let prevSibling = getPrevItem(firstItem);
    while (prevSibling && selectedItems.includes(prevSibling)) {
        prevSibling = getPrevItem(prevSibling);
    }
    let nextSibling = getNextItem(lastItem);
    while (nextSibling && selectedItems.includes(nextSibling)) {
        nextSibling = getNextItem(nextSibling);
    }
    let parentItem = getParentItem(firstItem);
    let focusTarget = prevSibling || nextSibling || parentItem;
    // Remove all selected items
    for (let item of selectedItems) {
        item.remove();
    }
    clearSelection();
    if (parentItem) updateToggle(parentItem);
    // Handle empty outline
    let outline = document.getElementById("outline");
    if (!outline.querySelector(".item")) {
        let newItem = createItem("");
        outline.appendChild(newItem);
        getTextEl(newItem).focus();
        save();
        return;
    }
    if (focusTarget) {
        suppressSelectionClear = true;
        let textEl = getTextEl(focusTarget);
        textEl.focus();
        setCursorPos(textEl, textEl.textContent.length);
    }
    save();
}

// Link Rendering

let urlPattern = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+/g;

function renderLinks(textEl) {
    let text = textEl.textContent;
    urlPattern.lastIndex = 0;
    if (!urlPattern.test(text)) return;
    urlPattern.lastIndex = 0;
    let frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        let a = document.createElement("a");
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
    let hasLinks = textEl.querySelector("a");
    if (!hasLinks) return;
    textEl.textContent = textEl.textContent;
}

function renderAllLinks() {
    let allTexts = document.querySelectorAll("#outline .text");
    for (let textEl of allTexts) {
        renderLinks(textEl);
    }
}

// Cursor Helpers

function getCursorPos(el) {
    let sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    let range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return 0;
    let preRange = document.createRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
}

function setCursorPos(el, pos) {
    let range = document.createRange();
    let sel = window.getSelection();
    if (el.childNodes.length === 0) {
        range.setStart(el, 0);
    } else {
        let node = el.childNodes[0];
        range.setStart(node, Math.min(pos, node.textContent.length));
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
}

// Persistence

function serialize(container) {
    let items = container.querySelectorAll(":scope > .item");
    let result = [];
    for (let item of items) {
        result.push({
            id: item.dataset.id,
            text: getTextEl(item).textContent,
            collapsed: item.classList.contains("collapsed"),
            children: serialize(getChildrenEl(item)),
        });
    }
    return result;
}

function deserialize(items, container) {
    for (let data of items) {
        let item = createItem(data.text);
        item.dataset.id = data.id;
        if (data.collapsed) {
            item.classList.add("collapsed");
        }
        container.appendChild(item);
        if (data.children && data.children.length > 0) {
            deserialize(data.children, getChildrenEl(item));
        }
        updateToggle(item);
    }
}

function save() {
    let outline = document.getElementById("outline");
    let data = {
        zoomedId: zoomedId,
        items: serialize(outline),
    };
    localStorage.setItem("tinynotes", JSON.stringify(data));
}

function load() {
    let raw = localStorage.getItem("tinynotes");
    if (!raw) return null;
    return JSON.parse(raw);
}

// Zoom

function applyZoom() {
    let outline = document.getElementById("outline");
    let els = outline.querySelectorAll(".zoom-root, .zoom-ancestor, .zoom-hidden");
    for (let el of els) {
        el.classList.remove("zoom-root", "zoom-ancestor", "zoom-hidden");
    }
    let breadcrumb = document.getElementById("breadcrumb");
    breadcrumb.innerHTML = "";
    if (!zoomedId) {
        let home = document.createElement("span");
        home.className = "breadcrumb-item";
        home.dataset.id = "root";
        home.textContent = "Home";
        breadcrumb.appendChild(home);
        return;
    }
    let target = getItemEl(zoomedId);
    if (!target) {
        zoomedId = null;
        applyZoom();
        return;
    }
    target.classList.add("zoom-root");
    // Hide siblings of zoom-root
    let rootParent = target.parentElement;
    for (let sibling of rootParent.children) {
        if (sibling !== target && sibling.classList.contains("item")) {
            sibling.classList.add("zoom-hidden");
        }
    }
    // Walk up ancestors
    let ancestor = getParentItem(target);
    while (ancestor) {
        ancestor.classList.add("zoom-ancestor");
        let parent = ancestor.parentElement;
        for (let sibling of parent.children) {
            if (sibling !== ancestor && sibling.classList.contains("item")) {
                sibling.classList.add("zoom-hidden");
            }
        }
        ancestor = getParentItem(ancestor);
    }
    // Build breadcrumb
    let crumbs = [{ id: "root", text: "Home" }];
    let node = target;
    let ancestorCrumbs = [];
    while (node) {
        let text = getTextEl(node).textContent || "(empty)";
        ancestorCrumbs.push({ id: node.dataset.id, text: text });
        node = getParentItem(node);
    }
    ancestorCrumbs.reverse();
    crumbs = crumbs.concat(ancestorCrumbs);
    for (let i = 0; i < crumbs.length; i++) {
        if (i > 0) {
            let sep = document.createElement("span");
            sep.className = "breadcrumb-sep";
            sep.innerHTML = " &gt; ";
            breadcrumb.appendChild(sep);
        }
        let span = document.createElement("span");
        span.className = "breadcrumb-item";
        span.dataset.id = crumbs[i].id;
        span.textContent = crumbs[i].text;
        breadcrumb.appendChild(span);
    }
}

function zoomTo(id) {
    zoomedId = id === "root" ? null : id;
    applyZoom();
    save();
}

// Structural Operations

function handleEnter(e) {
    e.preventDefault();
    let textEl = e.target;
    let item = textEl.closest(".item");
    let cursorPos = getCursorPos(textEl);
    let text = textEl.textContent;
    if (cursorPos >= text.length) {
        let childrenEl = getChildrenEl(item);
        if (hasChildren(item) && !item.classList.contains("collapsed")) {
            let newItem = createItem("");
            childrenEl.insertBefore(newItem, childrenEl.firstChild);
            updateToggle(item);
            getTextEl(newItem).focus();
        } else {
            let newItem = createItem("");
            item.parentElement.insertBefore(newItem, item.nextSibling);
            let parentItem = getParentItem(item);
            if (parentItem) updateToggle(parentItem);
            getTextEl(newItem).focus();
        }
    } else {
        let before = text.substring(0, cursorPos);
        let after = text.substring(cursorPos);
        textEl.textContent = before;
        let newItem = createItem(after);
        item.parentElement.insertBefore(newItem, item.nextSibling);
        let parentItem = getParentItem(item);
        if (parentItem) updateToggle(parentItem);
        let newTextEl = getTextEl(newItem);
        newTextEl.focus();
        setCursorPos(newTextEl, 0);
    }
    save();
}

function handleBackspace(e) {
    let textEl = e.target;
    let item = textEl.closest(".item");
    let cursorPos = getCursorPos(textEl);
    if (cursorPos !== 0) return;
    let sel = window.getSelection();
    if (!sel.isCollapsed) return;
    e.preventDefault();
    let text = textEl.textContent;
    let childrenEl = getChildrenEl(item);
    if (text === "" && !hasChildren(item)) {
        let visibleItems = getVisibleItems();
        let idx = visibleItems.indexOf(textEl);
        let prevTextEl = idx > 0 ? visibleItems[idx - 1] : null;
        let parentItem = getParentItem(item);
        item.remove();
        if (parentItem) updateToggle(parentItem);
        // If outline is now empty, create a starter bullet
        let outline = document.getElementById("outline");
        if (!outline.querySelector(".item")) {
            let newItem = createItem("");
            outline.appendChild(newItem);
            getTextEl(newItem).focus();
            save();
            return;
        }
        if (prevTextEl) {
            prevTextEl.focus();
            setCursorPos(prevTextEl, prevTextEl.textContent.length);
        }
    } else if (text === "" && hasChildren(item)) {
        let parentContainer = item.parentElement;
        let parentItem = getParentItem(item);
        let nextSibling = item.nextSibling;
        let visibleItems = getVisibleItems();
        let children = Array.from(childrenEl.querySelectorAll(":scope > .item"));
        let firstChildText = children.length > 0 ? getTextEl(children[0]) : null;
        let idx = firstChildText ? visibleItems.indexOf(firstChildText) : -1;
        let prevTextEl = idx > 0 ? visibleItems[idx - 1] : null;
        for (let child of children) {
            parentContainer.insertBefore(child, nextSibling);
        }
        item.remove();
        if (parentItem) updateToggle(parentItem);
        if (prevTextEl) {
            prevTextEl.focus();
            setCursorPos(prevTextEl, prevTextEl.textContent.length);
        }
    } else {
        let visibleItems = getVisibleItems();
        let idx = visibleItems.indexOf(textEl);
        if (idx <= 0) return;
        let prevTextEl = visibleItems[idx - 1];
        let prevItem = prevTextEl.closest(".item");
        let prevLen = prevTextEl.textContent.length;
        prevTextEl.textContent += text;
        let children = Array.from(childrenEl.querySelectorAll(":scope > .item"));
        let prevChildrenEl = getChildrenEl(prevItem);
        for (let child of children) {
            prevChildrenEl.appendChild(child);
        }
        let parentItem = getParentItem(item);
        item.remove();
        if (parentItem) updateToggle(parentItem);
        updateToggle(prevItem);
        prevTextEl.focus();
        setCursorPos(prevTextEl, prevLen);
    }
    save();
}

function handleTab(e) {
    e.preventDefault();
    let textEl = e.target;
    let item = textEl.closest(".item");
    let prevItem = getPrevItem(item);
    if (!prevItem) return;
    let cursorPos = getCursorPos(textEl);
    let prevChildrenEl = getChildrenEl(prevItem);
    prevChildrenEl.appendChild(item);
    if (prevItem.classList.contains("collapsed")) {
        prevItem.classList.remove("collapsed");
    }
    updateToggle(prevItem);
    let oldParent = getParentItem(prevItem);
    if (oldParent) updateToggle(oldParent);
    textEl.focus();
    setCursorPos(textEl, cursorPos);
    save();
}

function handleShiftTab(e) {
    e.preventDefault();
    let textEl = e.target;
    let item = textEl.closest(".item");
    let parentItem = getParentItem(item);
    if (!parentItem) return;
    if (parentItem.classList.contains("zoom-root")) return;
    let cursorPos = getCursorPos(textEl);
    let grandparentContainer = parentItem.parentElement;
    // Move following siblings into this item's children
    let nextSiblings = [];
    let sibling = getNextItem(item);
    while (sibling) {
        nextSiblings.push(sibling);
        sibling = getNextItem(sibling);
    }
    let childrenEl = getChildrenEl(item);
    for (let s of nextSiblings) {
        childrenEl.appendChild(s);
    }
    grandparentContainer.insertBefore(item, parentItem.nextSibling);
    updateToggle(parentItem);
    updateToggle(item);
    textEl.focus();
    setCursorPos(textEl, cursorPos);
    save();
}

function handleArrowUp(e) {
    e.preventDefault();
    let textEl = e.target;
    let visibleItems = getVisibleItems();
    let idx = visibleItems.indexOf(textEl);
    if (idx > 0) {
        let prevTextEl = visibleItems[idx - 1];
        prevTextEl.focus();
        setCursorPos(prevTextEl, prevTextEl.textContent.length);
    }
}

function handleArrowDown(e) {
    e.preventDefault();
    let textEl = e.target;
    let visibleItems = getVisibleItems();
    let idx = visibleItems.indexOf(textEl);
    if (idx < visibleItems.length - 1) {
        let nextTextEl = visibleItems[idx + 1];
        nextTextEl.focus();
        setCursorPos(nextTextEl, nextTextEl.textContent.length);
    }
}

// Collapse/Expand

function toggleCollapse(item) {
    if (!hasChildren(item)) return;
    item.classList.toggle("collapsed");
    updateToggle(item);
    save();
}

// Paste Handling

function handlePaste(e) {
    e.preventDefault();
    let text = e.clipboardData.getData("text/plain");
    let textEl = e.target;
    let pos = getCursorPos(textEl);
    let content = textEl.textContent;
    textEl.textContent = content.slice(0, pos) + text + content.slice(pos);
    setCursorPos(textEl, pos + text.length);
    save();
}

// Event Handling

function setupEvents() {
    let outline = document.getElementById("outline");
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
            // Modifier keys alone don't clear selection
            if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
            // Any other key clears selection and falls through
            clearSelection();
        }
        // Single-item handlers
        if (!e.target.classList.contains("text")) return;
        if (e.key === "Enter") {
            handleEnter(e);
        } else if (e.key === "Backspace") {
            handleBackspace(e);
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
    });
    outline.addEventListener("focusin", e => {
        if (!e.target.classList.contains("text")) return;
        if (suppressSelectionClear) {
            suppressSelectionClear = false;
        } else if (selectedItems.length > 0) {
            clearSelection();
        }
        stripLinks(e.target);
    });
    outline.addEventListener("focusout", e => {
        if (!e.target.classList.contains("text")) return;
        renderLinks(e.target);
    });
    outline.addEventListener("click", e => {
        // Shift+Click range selection
        if (e.shiftKey && (e.target.classList.contains("text") || e.target.classList.contains("bullet"))) {
            e.preventDefault();
            let clickedItem = e.target.closest(".item");
            if (!clickedItem) return;
            let anchorItem = selectionAnchor;
            if (!anchorItem) {
                let focused = document.activeElement;
                if (focused && focused.classList.contains("text")) {
                    anchorItem = focused.closest(".item");
                }
            }
            if (!anchorItem) return;
            // Must be same parent
            if (anchorItem.parentElement !== clickedItem.parentElement) return;
            let container = anchorItem.parentElement;
            let siblings = getSiblingItems(container);
            let anchorIdx = siblings.indexOf(anchorItem);
            let clickedIdx = siblings.indexOf(clickedItem);
            if (anchorIdx === -1 || clickedIdx === -1) return;
            let start = Math.min(anchorIdx, clickedIdx);
            let end = Math.max(anchorIdx, clickedIdx);
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
            let item = e.target.closest(".item");
            toggleCollapse(item);
        } else if (e.target.classList.contains("bullet")) {
            let item = e.target.closest(".item");
            zoomTo(item.dataset.id);
            if (!hasChildren(item)) {
                let newItem = createItem("");
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
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && selectedItems.length > 0) {
            e.preventDefault();
            clearSelection();
        }
    });
    let breadcrumb = document.getElementById("breadcrumb");
    breadcrumb.addEventListener("click", e => {
        let crumbItem = e.target.closest(".breadcrumb-item");
        if (!crumbItem) return;
        zoomTo(crumbItem.dataset.id);
    });
}

// Main

function main() {
    let breadcrumb = document.createElement("div");
    breadcrumb.id = "breadcrumb";
    document.body.appendChild(breadcrumb);
    let outline = document.createElement("div");
    outline.id = "outline";
    document.body.appendChild(outline);
    let data = load();
    if (data && data.items && data.items.length > 0) {
        deserialize(data.items, outline);
        zoomedId = data.zoomedId || null;
    } else {
        let item = createItem("");
        outline.appendChild(item);
    }
    applyZoom();
    renderAllLinks();
    setupEvents();
    let visibleItems = getVisibleItems();
    if (visibleItems.length > 0) {
        visibleItems[0].focus();
    }
}

(function() {
    main();
})();
