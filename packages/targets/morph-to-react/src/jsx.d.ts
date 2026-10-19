import type * as React from 'react';

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
