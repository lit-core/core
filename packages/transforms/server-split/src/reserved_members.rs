//! Names an `@action()` or `@loader()` method must not take.
//!
//! A server element is a real custom element, so a method named like a member of `Element`, `Node`,
//! `EventTarget`, `HTMLElement`, Lit's `ReactiveElement` or `ServerElement` would replace that member
//! on the compiled class. An action called `remove` would make `element.remove()` run a network
//! request, and one called `update` would be called by Lit's own update cycle.

/// Sorted, so membership is a binary search.
const RESERVED: &[&str] = &[
    "actionState",
    "actionUrl",
    "addController",
    "addEventListener",
    "adoptedCallback",
    "after",
    "animate",
    "append",
    "appendChild",
    "attachInternals",
    "attachShadow",
    "attributeChangedCallback",
    "attributes",
    "before",
    "blur",
    "checkVisibility",
    "children",
    "className",
    "click",
    "cloneNode",
    "closest",
    "compareDocumentPosition",
    "connectedCallback",
    "contains",
    "context",
    "createRenderRoot",
    "dir",
    "disconnectedCallback",
    "dispatchEvent",
    "draggable",
    "enableUpdating",
    "env",
    "firstUpdated",
    "focus",
    "formFields",
    "getActionState",
    "getAnimations",
    "getAttribute",
    "getBoundingClientRect",
    "getRootNode",
    "getUpdateComplete",
    "hasAttribute",
    "hasChildNodes",
    "hasUpdated",
    "hidden",
    "hidePopover",
    "id",
    "innerHTML",
    "insertAdjacentElement",
    "insertAdjacentHTML",
    "insertAdjacentText",
    "insertBefore",
    "isActionPending",
    "isConnected",
    "isUpdatePending",
    "lang",
    "matches",
    "normalize",
    "outerHTML",
    "parentNode",
    "performUpdate",
    "prepend",
    "querySelector",
    "querySelectorAll",
    "remove",
    "removeAttribute",
    "removeChild",
    "removeController",
    "removeEventListener",
    "render",
    "renderRoot",
    "replaceChild",
    "replaceChildren",
    "replaceWith",
    "requestFullscreen",
    "requestUpdate",
    "scheduleUpdate",
    "scroll",
    "scrollBy",
    "scrollIntoView",
    "scrollTo",
    "setAttribute",
    "shadowRoot",
    "shouldUpdate",
    "showPopover",
    "slot",
    "style",
    "tabIndex",
    "textContent",
    "title",
    "toggleAttribute",
    "togglePopover",
    "update",
    "updateComplete",
    "updated",
    "willUpdate",
];

pub fn is_reserved_member(name: &str) -> bool {
    RESERVED.binary_search(&name).is_ok()
}

/// Methods a server element may define that only ever run on the server.
///
/// `renderPending()` supplies the placeholder a streamed element shows until its loaders settle. The
/// worker keeps it and the client stub drops it, as with a loader.
pub const SERVER_ONLY_METHODS: &[&str] = &["renderPending"];

pub fn is_server_only_method(name: &str) -> bool {
    SERVER_ONLY_METHODS.contains(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_stays_sorted_and_free_of_duplicates_so_lookup_can_bisect() {
        assert!(RESERVED.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn well_known_members_are_reserved() {
        for name in [
            "remove",
            "update",
            "render",
            "click",
            "focus",
            "requestUpdate",
            "actionUrl",
        ] {
            assert!(is_reserved_member(name), "{name}");
        }
    }

    #[test]
    fn ordinary_names_are_not() {
        for name in ["add", "toggle", "removeTask", "load", "save", "reserve"] {
            assert!(!is_reserved_member(name), "{name}");
        }
    }
}
