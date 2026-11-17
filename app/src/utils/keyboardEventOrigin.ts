const origins = new WeakMap<Event, Event>();

export function keyboardEventOrigin(event: Event | undefined): Event | undefined {
  return event && (origins.get(event) ?? event);
}

export function forwardKeyboardEvent(event: KeyboardEvent): KeyboardEvent {
  const forwarded = new KeyboardEvent(event.type, {
    key: event.key,
    code: event.code,
    location: event.location,
    repeat: event.repeat,
    isComposing: event.isComposing,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
  });
  origins.set(forwarded, keyboardEventOrigin(event)!);
  return forwarded;
}
