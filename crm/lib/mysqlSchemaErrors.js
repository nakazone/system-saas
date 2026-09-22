/** Erros MySQL comuns quando a BD está atrás do código */
export function isNoSuchTableError(err) {
  return err && err.code === 'ER_NO_SUCH_TABLE';
}

export function isBadFieldError(err) {
  return err && err.code === 'ER_BAD_FIELD_ERROR';
}
