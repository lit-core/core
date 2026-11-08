import type * as React from 'react';

declare module '@carbon/web-components/es/components/button/button.scss.js' {
  const styles: { cssText: string };
  export default styles;
}

declare module '@carbon/web-components/es/components/checkbox/checkbox.scss.js' {
  const styles: { cssText: string };
  export default styles;
}

declare module '@carbon/web-components/es/components/tabs/tabs.scss.js' {
  const styles: { cssText: string };
  export default styles;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'cds-button': any;
      'cds-checkbox': any;
      'cds-tab': any;
      'cds-tabs': any;
      'cds-badge-indicator': any;
      'slot-boundary': any;
    }
  }
}
