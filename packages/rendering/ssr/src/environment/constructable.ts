export class ValidityStateStub {
  get badInput(): boolean {
    return false;
  }
  get customError(): boolean {
    return false;
  }
  get patternMismatch(): boolean {
    return false;
  }
  get rangeOverflow(): boolean {
    return false;
  }
  get rangeUnderflow(): boolean {
    return false;
  }
  get stepMismatch(): boolean {
    return false;
  }
  get tooLong(): boolean {
    return false;
  }
  get tooShort(): boolean {
    return false;
  }
  get typeMismatch(): boolean {
    return false;
  }
  get valid(): boolean {
    return true;
  }
  get valueMissing(): boolean {
    return false;
  }
}

export class CSSStyleSheetStub {
  cssRules: string[] = [];

  replaceSync(cssText: string): void {
    this.cssRules = [cssText];
  }

  async replace(cssText: string): Promise<CSSStyleSheetStub> {
    this.cssRules = [cssText];
    return this;
  }
}
