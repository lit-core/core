use crate::extractor::CustomElementTarget;

pub fn generate_proxy_wrapper(target: &CustomElementTarget) -> String {
    let proxy_name = format!("{}Proxy", target.class_name);
    let getter_name = format!("__getImpl_{}", target.class_name);
    let impl_var = format!("__impl_{}", target.class_name);
    let props_var = format!("__props_{}", target.class_name);

    let observed_attrs_json =
        serde_json::to_string(&target.observed_attributes).unwrap_or_else(|_| "[]".to_string());
    let properties_json =
        serde_json::to_string(&target.properties).unwrap_or_else(|_| "[]".to_string());

    let export_stmt = if target.is_default_export {
        format!("export default {};\n", proxy_name)
    } else if target.is_export {
        format!("export {{ {} as {} }};\n", proxy_name, target.class_name)
    } else {
        String::new()
    };

    format!(
        r#"let {impl_var} = null;
function {getter_name}() {{
  if (!{impl_var}) {{
    {impl_var} = {class_name};
  }}
  return {impl_var};
}}
class {proxy_name} extends HTMLElement {{
  static get observedAttributes() {{
    return {observed_attrs_json};
  }}
  static [Symbol.hasInstance](instance) {{
    const Impl = {getter_name}();
    return (Impl && instance instanceof Impl) || super[Symbol.hasInstance](instance);
  }}
  static getImplementation() {{
    return {getter_name}();
  }}
  static get formAssociated() {{
    const Impl = {getter_name}();
    return Boolean(Impl && Impl.formAssociated);
  }}
  constructor() {{
    const RealClass = {getter_name}();
    if (RealClass) {{
      if (Object.getPrototypeOf({proxy_name}.prototype) !== RealClass.prototype) {{
        Object.setPrototypeOf({proxy_name}.prototype, RealClass.prototype);
        Object.setPrototypeOf({proxy_name}, RealClass);
      }}
      return Reflect.construct(RealClass, [], new.target);
    }}
    super();
    this.__upgraded = false;
    this.__attrBuffer = null;
  }}
  attributeChangedCallback(name, oldValue, newValue) {{
    if (this.__upgraded) {{
      if (typeof super.attributeChangedCallback === 'function') {{
        super.attributeChangedCallback(name, oldValue, newValue);
      }}
    }} else {{
      if (!this.__attrBuffer) this.__attrBuffer = new Map();
      this.__attrBuffer.set(name, newValue);
    }}
  }}
  connectedCallback() {{
    this.__upgrade();
  }}
  __upgrade() {{
    if (this.__upgraded) return this;
    this.__upgraded = true;
    const RealClass = {getter_name}();
    if (!RealClass) return this;
    if (typeof RealClass.finalize === 'function') {{
      RealClass.finalize();
    }}
    Object.setPrototypeOf(this, RealClass.prototype);
    if (RealClass.elementStyles && !this.shadowRoot && typeof this.attachShadow === 'function') {{
      const root = this.attachShadow(RealClass.shadowRootOptions || {{ mode: 'open' }});
      if (Array.isArray(RealClass.elementStyles)) {{
        root.adoptedStyleSheets = RealClass.elementStyles.map((s) => s?.styleSheet || s).filter(Boolean);
      }} else if (RealClass.elementStyles?.styleSheet) {{
        root.adoptedStyleSheets = [RealClass.elementStyles.styleSheet];
      }}
    }}
    if (!this.renderOptions) {{
      this.renderOptions = {{ host: this }};
    }}
    this.isUpdatePending = false;
    this.hasUpdated = false;
    this._$Em = null;
    if (typeof this._$Ev === 'function') {{
      this._$Ev();
    }} else if (typeof RealClass.prototype._$Ev === 'function') {{
      RealClass.prototype._$Ev.call(this);
    }}
    if (this._$AL === undefined) {{
      this._$AL = new Map();
    }}
    if (this.__attrBuffer) {{
      for (const [k, v] of this.__attrBuffer) {{
        if (typeof this.attributeChangedCallback === 'function') {{
          this.attributeChangedCallback(k, null, v);
        }}
      }}
      this.__attrBuffer = null;
    }}
    if (!this.internals && typeof this.attachInternals === 'function') {{
      try {{
        this.internals = this.attachInternals();
      }} catch {{}}
    }}
    if (!this.customStates && this.internals?.states) {{
      this.customStates = {{
        set: (customState, active) => {{
          if (!this.internals?.states) return;
          try {{
            if (active) this.internals.states.add(customState);
            else this.internals.states.delete(customState);
          }} catch {{}}
        }},
        has: (customState) => {{
          if (!this.internals?.states) return false;
          try {{ return this.internals.states.has(customState); }} catch {{ return false; }}
        }}
      }};
    }}
    try {{
      const instance = Reflect.construct(RealClass, [], this.constructor);
      for (const k of Object.getOwnPropertyNames(instance)) {{
        if (!(k in this)) {{
          try {{
            const desc = Object.getOwnPropertyDescriptor(instance, k);
            if (desc) Object.defineProperty(this, k, desc);
          }} catch {{}}
        }}
      }}
      for (const s of Object.getOwnPropertySymbols(instance)) {{
        if (!(s in this)) {{
          try {{
            const desc = Object.getOwnPropertyDescriptor(instance, s);
            if (desc) Object.defineProperty(this, s, desc);
          }} catch {{}}
        }}
      }}
    }} catch {{
      try {{
        const dummy = new RealClass();
        for (const k of Object.getOwnPropertyNames(dummy)) {{
          if (!(k in this)) {{
            try {{
              const desc = Object.getOwnPropertyDescriptor(dummy, k);
              if (desc) Object.defineProperty(this, k, desc);
            }} catch {{}}
          }}
        }}
      }} catch {{}}
    }}
    if (this.initialReflectedProperties === undefined) {{
      this.initialReflectedProperties = new Map();
    }}
    if (this.assumeInteractionOn === undefined) {{
      this.assumeInteractionOn = [];
    }}
    if (this.validators === undefined) {{
      this.validators = [];
    }}
    if (this.emittedEvents === undefined) {{
      this.emittedEvents = [];
    }}
    if (typeof RealClass.prototype.connectedCallback === 'function') {{
      RealClass.prototype.connectedCallback.call(this);
    }}
    return this;
  }}
}}
const {props_var} = {properties_json};
for (const __p of {props_var}) {{
  Object.defineProperty({proxy_name}.prototype, __p, {{
    get() {{
      this.__upgrade();
      return this[__p];
    }},
    set(__v) {{
      this.__upgrade();
      this[__p] = __v;
    }},
    configurable: true,
    enumerable: true
  }});
}}
customElements.define('{tag_name}', {proxy_name});
{export_stmt}"#,
        impl_var = impl_var,
        getter_name = getter_name,
        class_name = target.class_name,
        proxy_name = proxy_name,
        observed_attrs_json = observed_attrs_json,
        props_var = props_var,
        properties_json = properties_json,
        tag_name = target.tag_name,
        export_stmt = export_stmt,
    )
}

pub fn generate_external_proxy_wrapper(tag_name: &str, class_name: &str) -> String {
    let proxy_name = format!("{}Proxy", class_name);
    format!(
        r#"class {proxy_name} extends HTMLElement {{
  static get observedAttributes() {{
    return (typeof {class_name} !== 'undefined' && {class_name}.observedAttributes) || [];
  }}
  static [Symbol.hasInstance](instance) {{
    return (typeof {class_name} !== 'undefined' && {class_name} && instance instanceof {class_name}) || super[Symbol.hasInstance](instance);
  }}
  static getImplementation() {{
    return {class_name};
  }}
  static get formAssociated() {{
    return Boolean(typeof {class_name} !== 'undefined' && {class_name} && {class_name}.formAssociated);
  }}
  constructor() {{
    const RealClass = typeof {class_name} !== 'undefined' ? {class_name} : null;
    if (RealClass) {{
      if (Object.getPrototypeOf({proxy_name}.prototype) !== RealClass.prototype) {{
        Object.setPrototypeOf({proxy_name}.prototype, RealClass.prototype);
        Object.setPrototypeOf({proxy_name}, RealClass);
      }}
      return Reflect.construct(RealClass, [], new.target);
    }}
    super();
    this.__upgraded = false;
    this.__attrBuffer = null;
  }}
  attributeChangedCallback(name, oldValue, newValue) {{
    if (this.__upgraded) {{
      if (typeof super.attributeChangedCallback === 'function') {{
        super.attributeChangedCallback(name, oldValue, newValue);
      }}
    }} else {{
      if (!this.__attrBuffer) this.__attrBuffer = new Map();
      this.__attrBuffer.set(name, newValue);
    }}
  }}
  connectedCallback() {{
    this.__upgrade();
  }}
  __upgrade() {{
    if (this.__upgraded) return this;
    this.__upgraded = true;
    const RealClass = {class_name};
    if (!RealClass) return this;
    if (typeof RealClass.finalize === 'function') {{
      RealClass.finalize();
    }}
    Object.setPrototypeOf(this, RealClass.prototype);
    if (RealClass.elementStyles && !this.shadowRoot && typeof this.attachShadow === 'function') {{
      const root = this.attachShadow(RealClass.shadowRootOptions || {{ mode: 'open' }});
      if (Array.isArray(RealClass.elementStyles)) {{
        root.adoptedStyleSheets = RealClass.elementStyles.map((s) => s?.styleSheet || s).filter(Boolean);
      }} else if (RealClass.elementStyles?.styleSheet) {{
        root.adoptedStyleSheets = [RealClass.elementStyles.styleSheet];
      }}
    }}
    if (!this.renderOptions) {{
      this.renderOptions = {{ host: this }};
    }}
    this.isUpdatePending = false;
    this.hasUpdated = false;
    this._$Em = null;
    if (typeof this._$Ev === 'function') {{
      this._$Ev();
    }} else if (typeof RealClass.prototype._$Ev === 'function') {{
      RealClass.prototype._$Ev.call(this);
    }}
    if (this._$AL === undefined) {{
      this._$AL = new Map();
    }}
    if (this.__attrBuffer) {{
      for (const [k, v] of this.__attrBuffer) {{
        if (typeof this.attributeChangedCallback === 'function') {{
          this.attributeChangedCallback(k, null, v);
        }}
      }}
      this.__attrBuffer = null;
    }}
    if (!this.internals && typeof this.attachInternals === 'function') {{
      try {{
        this.internals = this.attachInternals();
      }} catch {{}}
    }}
    if (!this.customStates && this.internals?.states) {{
      this.customStates = {{
        set: (customState, active) => {{
          if (!this.internals?.states) return;
          try {{
            if (active) this.internals.states.add(customState);
            else this.internals.states.delete(customState);
          }} catch {{}}
        }},
        has: (customState) => {{
          if (!this.internals?.states) return false;
          try {{ return this.internals.states.has(customState); }} catch {{ return false; }}
        }}
      }};
    }}
    try {{
      const instance = Reflect.construct(RealClass, [], this.constructor);
      for (const k of Object.getOwnPropertyNames(instance)) {{
        if (!(k in this)) {{
          try {{
            const desc = Object.getOwnPropertyDescriptor(instance, k);
            if (desc) Object.defineProperty(this, k, desc);
          }} catch {{}}
        }}
      }}
      for (const s of Object.getOwnPropertySymbols(instance)) {{
        if (!(s in this)) {{
          try {{
            const desc = Object.getOwnPropertyDescriptor(instance, s);
            if (desc) Object.defineProperty(this, s, desc);
          }} catch {{}}
        }}
      }}
    }} catch {{
      try {{
        const dummy = new RealClass();
        for (const k of Object.getOwnPropertyNames(dummy)) {{
          if (!(k in this)) {{
            try {{
              const desc = Object.getOwnPropertyDescriptor(dummy, k);
              if (desc) Object.defineProperty(this, k, desc);
            }} catch {{}}
          }}
        }}
      }} catch {{}}
    }}
    if (this.initialReflectedProperties === undefined) {{
      this.initialReflectedProperties = new Map();
    }}
    if (this.assumeInteractionOn === undefined) {{
      this.assumeInteractionOn = [];
    }}
    if (this.validators === undefined) {{
      this.validators = [];
    }}
    if (this.emittedEvents === undefined) {{
      this.emittedEvents = [];
    }}
    if (typeof RealClass.prototype.connectedCallback === 'function') {{
      RealClass.prototype.connectedCallback.call(this);
    }} else if (typeof this.connectedCallback === 'function' && this.connectedCallback !== RealClass.prototype.connectedCallback) {{
      RealClass.prototype.connectedCallback?.call(this);
    }}
    if (typeof this.requestUpdate === 'function') {{
      this.requestUpdate();
    }}
    return this;
  }}
}}
customElements.define('{tag_name}', {proxy_name});
"#,
        class_name = class_name,
        proxy_name = proxy_name,
        tag_name = tag_name,
    )
}
