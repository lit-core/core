import { action, loader } from '@lit-core/server-elements';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface ProductInventoryState {
  stockCount: number;
  warehouse: string;
  isAvailable: boolean;
}

/**
 * Synchronous page header rendered at the edge.
 */
@customElement('ecommerce-header')
export class EcommerceHeaderElement extends LitElement {
  static properties = {
    cartCount: { type: Number },
  };

  cartCount = 0;

  render() {
    return html`
      <header class="ecommerce-header">
        <div class="logo">Mechanical Keyboard Pro Store</div>
        <nav class="nav-links">
          <a href="/">Home</a>
          <a href="/catalog">Keyboards</a>
          <a href="/accessories">Accessories</a>
        </nav>
        <div class="header-cart">
          <span class="cart-badge">Cart: ${this.cartCount}</span>
        </div>
      </header>
    `;
  }
}

/**
 * Fast sibling server element rendering product details and pricing (<10ms).
 */
@customElement('product-hero')
export class ProductHeroElement extends LitElement {
  static properties = {
    sku: { type: String },
    title: { type: String },
    price: { type: Number },
    currency: { type: String },
  };

  sku = 'APX-9800';
  title = 'Apex Pro Wireless Mechanical Keyboard';
  price = 189.99;
  currency = 'USD';

  render() {
    return html`
      <section class="product-hero">
        <h1 class="product-title">${this.title}</h1>
        <div class="product-meta">
          <span class="product-sku">SKU: ${this.sku}</span>
          <span class="product-price">$${this.price.toFixed(2)} ${this.currency}</span>
        </div>
        <div class="product-gallery">
          <img src="/assets/keyboard-hero.webp" alt="Keyboard top view" class="hero-image" />
        </div>
      </section>
    `;
  }
}

/**
 * Slow async server element simulating a 200ms database inventory check.
 * Streams a pending skeleton during initial DSD and resolves out-of-order.
 */
@customElement('product-inventory')
export class ProductInventoryElement extends LitElement {
  static properties = {
    sku: { type: String },
    stock: { type: Number, state: true },
    warehouse: { type: String, state: true },
    loaded: { type: Boolean, state: true },
  };

  sku = 'APX-9800';
  stock = 0;
  warehouse = '';
  loaded = false;

  @loader()
  async loadInventory(env: { DB?: any; latencyMs?: number }) {
    const latency = env?.latencyMs ?? 200;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
    this.stock = 14;
    this.warehouse = 'US-East Central Distribution Hub';
    this.loaded = true;
  }

  render() {
    if (!this.loaded) {
      return html`
        <div class="inventory-skeleton" slot="pending">
          <div class="skeleton-shimmer">Checking real-time warehouse inventory...</div>
        </div>
      `;
    }

    return html`
      <div class="inventory-card in-stock">
        <span class="stock-status">
          ${this.stock > 0 ? `In stock (${this.stock} units available)` : 'Backordered'}
        </span>
        <span class="warehouse-location">Fulfillment: ${this.warehouse}</span>
      </div>
    `;
  }
}

/**
 * Interactive product option / variant selector.
 */
@customElement('product-options')
export class ProductOptionsElement extends LitElement {
  static properties = {
    selectedSwitch: { type: String },
    selectedFinish: { type: String },
  };

  selectedSwitch = 'tactile-brown';
  selectedFinish = 'space-gray';

  render() {
    return html`
      <div class="product-options">
        <label class="option-label">Switch type:</label>
        <div class="option-pills">
          <span class="pill ${this.selectedSwitch === 'linear-red' ? 'active' : ''}">Linear Red</span>
          <span class="pill ${this.selectedSwitch === 'tactile-brown' ? 'active' : ''}">Tactile Brown</span>
          <span class="pill ${this.selectedSwitch === 'clicky-blue' ? 'active' : ''}">Clicky Blue</span>
        </div>
        <label class="option-label">Case finish:</label>
        <div class="option-pills">
          <span class="pill ${this.selectedFinish === 'space-gray' ? 'active' : ''}">Space Gray</span>
          <span class="pill ${this.selectedFinish === 'silver' ? 'active' : ''}">Silver Anodized</span>
        </div>
      </div>
    `;
  }
}

/**
 * Server element handling add-to-cart mutations via @action().
 * Emits surgical ndjson patch frames upon execution.
 */
@customElement('cart-action')
export class CartActionElement extends LitElement {
  static properties = {
    sku: { type: String },
    cartCount: { type: Number, state: true },
    statusMessage: { type: String, state: true },
  };

  sku = 'APX-9800';
  cartCount = 0;
  statusMessage = '';

  @action()
  async addToCart(sku: string, quantity: number) {
    if (!sku || quantity <= 0) {
      throw new Error('Invalid product SKU or quantity');
    }
    this.cartCount += quantity;
    this.statusMessage = `Added ${quantity} unit(s) of ${sku} to cart`;
  }

  render() {
    return html`
      <div class="cart-control">
        <span class="cart-indicator">Cart (${this.cartCount})</span>
        <button
          class="add-to-cart-btn"
          @click=${() => this.addToCart(this.sku, 1)}
        >
          Add to cart
        </button>
        <span class="cart-feedback">${this.statusMessage}</span>
      </div>
    `;
  }
}

/**
 * Nested client-side Lit component testing boundary isolation.
 * The server element passes properties/attributes without touching its inner shadow DOM.
 */
@customElement('customer-rating-stars')
export class CustomerRatingStarsElement extends LitElement {
  static properties = {
    rating: { type: Number },
    reviewCount: { type: Number },
  };

  rating = 4.8;
  reviewCount = 142;

  render() {
    return html`
      <div class="rating-stars" aria-label="Rating: ${this.rating} out of 5 stars">
        <span class="stars-fill">★★★★★</span>
        <span class="rating-score">${this.rating.toFixed(1)}</span>
        <span class="review-count">(${this.reviewCount} customer reviews)</span>
      </div>
    `;
  }
}

/**
 * Top-level page host composing the e-commerce product route.
 */
@customElement('ecommerce-product-page')
export class EcommerceProductPageElement extends LitElement {
  static properties = {
    sku: { type: String },
    cartCount: { type: Number, state: true },
  };

  sku = 'APX-9800';
  cartCount = 0;

  render() {
    return html`
      <div class="page-container">
        <ecommerce-header .cartCount=${this.cartCount}></ecommerce-header>
        <main class="product-layout">
          <product-hero .sku=${this.sku}></product-hero>
          <customer-rating-stars></customer-rating-stars>
          <product-inventory .sku=${this.sku}></product-inventory>
          <product-options></product-options>
          <cart-action .sku=${this.sku} .cartCount=${this.cartCount}></cart-action>
        </main>
      </div>
    `;
  }
}
