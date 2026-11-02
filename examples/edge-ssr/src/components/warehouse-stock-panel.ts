import { action, loader } from '@lit-core/server-elements';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('warehouse-stock-panel')
export class WarehouseStockPanel extends LitElement {
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

    .metric-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
    }

    .stock-count {
      font-size: 1rem;
      font-weight: 400;
      color: #18181b;
      font-variant-numeric: tabular-nums;
    }

    .reserved-count {
      font-size: 1rem;
      font-weight: 300;
      color: #71717a;
      font-variant-numeric: tabular-nums;
    }

    .hub-label {
      margin: 0;
      font-size: 1rem;
      font-weight: 300;
      color: #52525b;
    }

    .reserve-btn {
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
  @state() units = 0;
  @state() reserved = 0;
  @state() stockSummary = '0 units in stock';
  @state() reservedSummary = '0 reserved';
  @state() hubSummary = 'Stockholm harbour depot';

  @loader()
  async loadStock() {
    await new Promise((resolve) => setTimeout(resolve, 12));
    this.units = 14;
    this.reserved = 0;
    this.stockSummary = '14 units in stock';
    this.reservedSummary = '0 reserved';
    this.hubSummary = 'Stockholm harbour depot';
  }

  @action()
  async reserveUnit() {
    if (this.units > 0) {
      this.units -= 1;
      this.reserved += 1;
      this.stockSummary = `${this.units} units in stock`;
      this.reservedSummary = `${this.reserved} reserved`;
    }
  }

  render() {
    return html`
      <div class="surface-card">
        <div class="metric-row">
          <span class="stock-count">${this.stockSummary}</span>
          <span class="reserved-count">${this.reservedSummary}</span>
        </div>
        <p class="hub-label">${this.hubSummary}</p>
        <button type="button" class="reserve-btn" @click=${this.reserveUnit}>Reserve unit</button>
      </div>
    `;
  }
}
