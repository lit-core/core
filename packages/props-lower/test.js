import assert from 'node:assert';
import { transformLitProps } from './src/index.js';

console.log('Testing @uibit/props-lower native addon...');

// Test 1: @customElement
{
  const input = `
    import {LitElement} from 'lit';
    import {customElement} from 'lit/decorators.js';

    @customElement('my-element')
    class MyElement extends LitElement {}
  `;
  const res = transformLitProps(input);
  assert(!res.code.includes('@customElement'), 'Should strip @customElement');
  assert(res.code.includes('customElements.define("my-element", MyElement)'), 'Should emit customElements.define');
  assert(!res.code.includes('decorators.js'), 'Should strip unused Lit decorators import');
  console.log('  ✔ @customElement transformation');
}

// Test 2: @property and constructor synthesis
{
  const input = `
    import {LitElement} from 'lit';
    import {property} from 'lit/decorators.js';

    class MyElement extends LitElement {
      @property({type: String})
      greeting = 'hello world';
    }
  `;
  const res = transformLitProps(input);
  assert(!res.code.includes('@property'), 'Should strip @property');
  assert(res.code.includes('static properties'), 'Should synthesize static properties');
  assert(res.code.includes('type: String'), 'Should preserve property options');
  assert(res.code.includes('constructor()'), 'Should synthesize constructor');
  assert(res.code.includes('super()'), 'Should call super()');
  assert(res.code.includes('this.greeting = "hello world"') || res.code.includes("this.greeting = 'hello world'"), 'Should initialize property in constructor');
  console.log('  ✔ @property and constructor synthesis');
}

// Test 3: @state
{
  const input = `
    import {LitElement} from 'lit';
    import {state} from 'lit/decorators.js';

    class MyElement extends LitElement {
      @state()
      count = 0;
    }
  `;
  const res = transformLitProps(input);
  assert(!res.code.includes('@state'), 'Should strip @state');
  assert(res.code.includes('state: true'), 'Should set state: true in static properties');
  assert(res.code.includes('this.count = 0'), 'Should initialize count in constructor');
  console.log('  ✔ @state transformation');
}

// Test 4: @query and @queryAll
{
  const input = `
    import {LitElement} from 'lit';
    import {query, queryAll} from 'lit/decorators.js';

    class MyElement extends LitElement {
      @query('#myDiv')
      div: HTMLDivElement;

      @queryAll('.items')
      items: NodeList;
    }
  `;
  const res = transformLitProps(input);
  assert(!res.code.includes('@query'), 'Should strip @query');
  assert(res.code.includes('get div()'), 'Should generate get div()');
  assert(res.code.includes('this.renderRoot?.querySelector("#myDiv")'), 'Should call querySelector');
  assert(res.code.includes('get items()'), 'Should generate get items()');
  assert(res.code.includes('this.renderRoot?.querySelectorAll(".items")'), 'Should call querySelectorAll');
  console.log('  ✔ @query and @queryAll transformation');
}

// Test 5: @queryAsync
{
  const input = `
    import {LitElement} from 'lit';
    import {queryAsync} from 'lit/decorators.js';

    class MyElement extends LitElement {
      @queryAsync('#btn')
      btn: Promise<HTMLElement>;
    }
  `;
  const res = transformLitProps(input);
  assert(!res.code.includes('@queryAsync'), 'Should strip @queryAsync');
  assert(res.code.includes('get btn()'), 'Should generate get btn()');
  assert(res.code.includes('this.updateComplete.then'), 'Should hook updateComplete');
  console.log('  ✔ @queryAsync transformation');
}

// Test 6: @queryAssignedElements and @queryAssignedNodes
{
  const input = `
    import {LitElement} from 'lit';
    import {queryAssignedElements, queryAssignedNodes} from 'lit/decorators.js';

    class MyElement extends LitElement {
      @queryAssignedElements({slot: 'content'})
      content: HTMLElement[];

      @queryAssignedNodes()
      nodes: Node[];
    }
  `;
  const res = transformLitProps(input);
  assert(res.code.includes('get content()'));
  assert(res.code.includes('slot[name=content]'));
  assert(res.code.includes('assignedElements'));
  assert(res.code.includes('get nodes()'));
  assert(res.code.includes('slot:not([name])'));
  assert(res.code.includes('assignedNodes'));
  console.log('  ✔ @queryAssignedElements and @queryAssignedNodes transformation');
}

// Test 7: @eventOptions
{
  const input = `
    import {LitElement} from 'lit';
    import {eventOptions} from 'lit/decorators.js';

    class MyElement extends LitElement {
      @eventOptions({passive: true})
      onClick(e) {
        console.log(e);
      }
    }
  `;
  const res = transformLitProps(input);
  assert(!res.code.includes('@eventOptions'));
  assert(res.code.includes('Object.assign(MyElement.prototype.onClick, { passive: true })'));
  console.log('  ✔ @eventOptions transformation');
}

// Test 8: @localized
{
  const input = `
    import {LitElement} from 'lit';
    import {localized} from '@lit/localize';

    @localized()
    class MyElement extends LitElement {}
  `;
  const res = transformLitProps(input);
  assert(!res.code.includes('@localized'));
  assert(res.code.includes('updateWhenLocaleChanges'));
  assert(res.code.includes('updateWhenLocaleChanges(this)'));
  console.log('  ✔ @localized transformation');
}

// Test 9: Sourcemap generation
{
  const input = `
    import {LitElement} from 'lit';
    import {customElement} from 'lit/decorators.js';

    @customElement('my-element')
    class MyElement extends LitElement {}
  `;
  const res = transformLitProps(input, { sourcemap: true, filename: 'test.ts' });
  assert(res.map, 'Should generate sourcemap when requested');
  const parsedMap = JSON.parse(res.map);
  assert(parsedMap.mappings, 'Sourcemap should have mappings');
  console.log('  ✔ Sourcemap generation');
}

console.log('\nAll 9 integration tests passed successfully!\n');
