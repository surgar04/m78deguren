export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key) || event.repeat) return null;
  const code = event.code;
  const main = /^Key[A-Z]$/u.test(code)
    ? code.slice(3)
    : /^Digit[0-9]$/u.test(code)
      ? code.slice(5)
      : /^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(code)
        ? code
        : (
            {
              Space: 'Space',
              ArrowLeft: 'Left',
              ArrowRight: 'Right',
              ArrowUp: 'Up',
              ArrowDown: 'Down',
              Enter: 'Enter',
              Tab: 'Tab',
              Backspace: 'Backspace',
              Delete: 'Delete',
              Home: 'Home',
              End: 'End',
              PageUp: 'PageUp',
              PageDown: 'PageDown',
              Insert: 'Insert',
            } as Record<string, string>
          )[code];
  if (!main || (!event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d+$/u.test(main)))
    return null;
  return [
    ...(event.ctrlKey ? ['Ctrl'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
    ...(event.metaKey ? ['Super'] : []),
    main,
  ].join('+');
}
