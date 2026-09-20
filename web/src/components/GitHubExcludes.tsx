import { t } from '../i18n';

/**
 * Los patrones se escriben uno por linea: es la forma en la que se leen de un
 * vistazo, y evita inventar un separador que haya que explicar.
 */
export const GitHubExcludes = ({ value, disabled, onChange }: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) => (
  <div className="field">
    <label htmlFor="github-excludes">{t('github.excludes')}</label>
    <textarea
      id="github-excludes"
      className="mono"
      rows={4}
      spellCheck={false}
      disabled={disabled}
      placeholder={t('github.excludesPlaceholder')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
    <p className="field__hint">{t('github.excludesHint')}</p>
  </div>
);

export const toPatterns = (value: string) =>
  value.split('\n').map((line) => line.trim()).filter(Boolean);
