import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@material/web/button/filled-button.js';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('product-edition-picker')
export class ProductEditionPicker extends LitElement {
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
      gap: 1.25rem;
    }

    .filter-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }

    .filter-label {
      width: 7rem;
      font-size: 1rem;
      font-weight: 300;
      color: #71717a;
      flex-shrink: 0;
    }

    .pill-group {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .pill-btn {
      font-family: inherit;
      font-size: 1rem;
      font-weight: 300;
      color: #52525b;
      background-color: #fafafb;
      border: none;
      border-radius: 0.75rem;
      padding: 0.5rem 0.9rem;
      cursor: pointer;
    }

    .pill-btn[aria-pressed="true"] {
      background-color: #18181b;
      color: #ffffff;
      font-weight: 500;
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      font-size: 1rem;
      font-weight: 400;
      color: #18181b;
    }

    .engraving-input {
      font-family: inherit;
      font-size: 1rem;
      font-weight: 300;
      color: #18181b;
      background-color: #fafafb;
      border: none;
      box-shadow: 0 0 0 1px rgba(24, 24, 27, 0.08);
      border-radius: 0.75rem;
      padding: 0.65rem 0.9rem;
      width: 100%;
      box-sizing: border-box;
    }

    .action-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .helper-note {
      font-size: 1rem;
      font-weight: 300;
      color: #71717a;
    }
  `;

  @property({ type: String }) edition = 'oak';
  @state() confirmed = false;

  private selectOak() {
    this.edition = 'oak';
    this.confirmed = false;
  }

  private selectWalnut() {
    this.edition = 'walnut';
    this.confirmed = false;
  }

  private confirmSelection() {
    this.confirmed = true;
  }

  render() {
    const editionLabel = this.edition === 'walnut' ? 'Smoked walnut' : 'Natural oak';
    return html`
      <div class="surface-card">
        <div class="filter-row">
          <span class="filter-label">Timber finish</span>
          <div class="pill-group">
            <button
              type="button"
              class="pill-btn"
              data-edition="oak"
              aria-pressed=${this.edition !== 'walnut' ? 'true' : 'false'}
              @click=${this.selectOak}
            >
              Natural oak
            </button>
            <button
              type="button"
              class="pill-btn"
              data-edition="walnut"
              aria-pressed=${this.edition === 'walnut' ? 'true' : 'false'}
              @click=${this.selectWalnut}
            >
              Smoked walnut
            </button>
          </div>
        </div>

        <div class="status-row">
          <span class="selected-edition">${editionLabel}</span>
          <wa-badge variant="neutral">Made to order</wa-badge>
        </div>

        <input
          class="engraving-input"
          type="text"
          placeholder="Optional brass plate engraving"
          aria-label="Optional brass plate engraving"
        />

        <div class="action-row">
          <span class="helper-note">${this.confirmed ? 'Finish confirmed' : 'Ready for workshop queue'}</span>
          <md-filled-button @click=${this.confirmSelection}>Confirm finish</md-filled-button>
        </div>
      </div>
    `;
  }
}
