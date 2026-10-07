#!/usr/bin/env node
/**
 * Maakt het `wrapper`-element van de app bruikbaar buiten de browser.
 *
 * De "File upload"-tegel in het dialoogvenster is geen <button> maar een
 * opgemaakte <div> met een click-handler. Een synthetische .click() daarop
 * doet niets. Daarom zoeken we de handler op in de React-state die aan het
 * element hangt, en roepen die direct aan.
 *
 * Levert ook de knop waarmee je een bestand kiest, zodat we het
 * bestandsdialoog kunnen overslaan en het bestand direct kunnen zetten.
 */
export const REACT_CLICK_HELPER = `
(() => {
  // React bewaart de fiber onder een van deze sleutels op het DOM-element.
  const fiberKey = (el) =>
    Object.keys(el).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
    );

  const findProps = (el) => {
    if (!el) return null;
    // Zoek de dichtstbijzijnde fiber met een onClick in de props.
    let node = el;
    const key = fiberKey(node);
    if (!key) return null;
    let fiber = node[key];
    let guard = 0;
    while (fiber && guard < 60) {
      const props = fiber.memoizedProps;
      if (props && (typeof props.onClick === 'function' || typeof props.onMouseDown === 'function')) {
        return props;
      }
      fiber = fiber.return;
      guard += 1;
    }
    return null;
  };

  window.__cavascpReactClick = (el) => {
    const props = findProps(el);
    if (!props) return { ok: false, reason: 'geen click-handler gevonden' };
    try {
      const event = {
        preventDefault() {},
        stopPropagation() {},
        nativeEvent: { stopImmediatePropagation() {} },
        currentTarget: el,
        target: el,
        bubbles: true,
        type: 'click',
      };
      if (props.onMouseDown) props.onMouseDown(event);
      if (props.onClick) props.onClick(event);
      return { ok: true, via: props.onMouseDown ? 'onMouseDown' : 'onClick' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  };

  /** Zoek een element op tekst, met de kleinste tekstomvang (diepste match). */
  window.__cavascpFindByText = (pattern, { maxLength = 200 } = {}) => {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    const nodes = [...document.querySelectorAll('button, [role="button"], a, li, div, label, span')];
    const matches = nodes.filter((n) => {
      const text = (n.textContent || '').trim();
      return text && text.length <= maxLength && re.test(text);
    });
    // De diepste (kleinste) match is vrijwel altijd de klikbare tegel.
    matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return matches;
  };

  window.__cavascpClickText = (pattern, options) => {
    const matches = window.__cavascpFindByText(pattern, options);
    for (const el of matches) {
      const result = window.__cavascpReactClick(el);
      if (result.ok) return { ...result, text: (el.textContent || '').trim().slice(0, 70) };
      // Terugvallen op een gewone klik als er geen handler is.
      try {
        el.click();
        return { ok: true, via: 'native-click', text: (el.textContent || '').trim().slice(0, 70) };
      } catch {
        /* probeer de volgende */
      }
    }
    return { ok: false, reason: 'geen klikbaar element gevonden', tried: matches.length };
  };

  return true;
})()
`;
