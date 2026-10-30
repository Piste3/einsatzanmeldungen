'use strict';

class ValidationError extends Error {
  constructor(messages) {
    super(messages.join(' '));
    this.messages = messages;
  }
}

// Gleichzeitige Änderung: jemand anderes hat den Datensatz inzwischen gespeichert
class ConflictError extends Error {
  constructor(current, lastChange) {
    super('Konflikt');
    this.current = current;
    this.lastChange = lastChange;
  }
}

class ReadOnlyError extends Error {
  constructor(message = 'Dieser Einsatz ist abgeschlossen. Änderungen sind nur noch durch einen Admin mit Begründung möglich.') {
    super(message);
  }
}

module.exports = { ValidationError, ConflictError, ReadOnlyError };
