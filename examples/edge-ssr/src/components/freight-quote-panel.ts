import { action, loader } from '@lit-core/server-elements';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('freight-quote-panel')
export class FreightQuotePanel extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .surface-card {
      background-color: #ffffff;
      border-radius: 1rem;
      padding: 1.5rem;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(24, 24, 27, 0.05);
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .freight-method {
      font-size: 1rem;
      font-weight: 400;
      color: #18181b;
    }

    .freight-corridor {
      margin: 0;
      font-size: 1rem;
      font-weight: 300;
      color: #52525b;
    }

    .method-btn {
      align-self: flex-start;
      font-family: inherit;
      font-size: 1rem;
      font-weight: 500;
      color: #ffffff;
      background-color: #047857;
      border: none;
      border-radius: 0.75rem;
      padding: 0.6rem 1.1rem;
      cursor: pointer;
    }
  `;

  @property({ type: String }) sku = 'nordic-desk-01';
  @property({ type: String }) region = 'stockholm';
  @state() express = false;
  @state() methodSummary = 'Standard freight (4 days)';
  @state() corridorSummary = 'Nordic rail corridor via Malmo';

  @loader()
  async loadQuote() {
    await new Promise((resolve) => setTimeout(resolve, 160));
    this.express = false;
    this.methodSummary = 'Standard freight (4 days)';
    this.corridorSummary = 'Nordic rail corridor via Malmo';
  }

  @action()
  async toggleMethod() {
    this.express = !this.express;
    this.methodSummary = this.express ? 'Express rail (1 day)' : 'Standard freight (4 days)';
  }

  render() {
    return html`
      <div class="surface-card">
        <span class="freight-method">${this.methodSummary}</span>
        <p class="freight-corridor">${this.corridorSummary}</p>
        <button type="button" class="method-btn" @click=${this.toggleMethod}>Switch to express rail</button>
      </div>
    `;
  }
}
