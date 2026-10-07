import React, { useId } from 'react';
import { AddMode, availableAddModes, SeasonTiming } from '../../features/archive/addMode';
import { statusKey } from '../../shared/i18n/keys';
import { useI18n } from '../../shared/i18n/useI18n';
import { StatusRule } from '../AnimeCard';

const HINT_KEY = {
  COMPLETED: 'addMode.hint.COMPLETED',
  WATCHING: 'addMode.hint.WATCHING',
  PLAN: 'addMode.hint.PLAN',
} as const;

interface AddModeControlProps {
  mode: AddMode;
  timing: SeasonTiming;
  onChange: (mode: AddMode) => void;
  /** Id of the hint sentence, so each catalogue entry can reference it. */
  hintId: string;
}

/**
 * "Add as: Completed / Watching / Plan to Watch". Visible, sticky while browsing the catalogue, and
 * changeable before any click, so rebuilding an old season's history takes one click per title.
 */
export const AddModeControl: React.FC<AddModeControlProps> = ({ mode, timing, onChange, hintId }) => {
  const { t } = useI18n();
  const name = useId();
  const modes = availableAddModes(timing);
  const hint = timing === 'future' ? t('addMode.future') : t(HINT_KEY[mode]);

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-yearbook-line bg-yearbook-paper">
        <fieldset className="flex flex-wrap items-center gap-x-1 py-1" aria-describedby={hintId}>
          <legend className="sr-only">{t('addMode.label')}</legend>
          <span aria-hidden="true" className="mr-1 text-xs font-medium text-yearbook-ink sm:mr-2">
            {t('addMode.label')}
          </span>
          {modes.map((option) =>
            modes.length > 1 ? (
              <label key={option} className="relative cursor-pointer">
                <input
                  type="radio"
                  name={name}
                  value={option}
                  checked={option === mode}
                  onChange={() => onChange(option)}
                  className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
                />
                <span className="ah-choice relative flex min-h-10 items-center gap-1.5 px-1.5 text-[13px] text-yearbook-muted transition-colors duration-[var(--ah-motion)] peer-checked:text-yearbook-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-yearbook-sky hover:text-yearbook-ink sm:px-2">
                  <span aria-hidden="true" className="ah-choice-rule" />
                  <span className="hidden sm:contents">
                    <StatusRule status={option} />
                  </span>
                  {t(statusKey(option))}
                </span>
              </label>
            ) : (
              <span key={option} className="flex min-h-10 items-center gap-1.5 px-2 text-[13px] text-yearbook-ink">
                <StatusRule status={option} />
                {t(statusKey(option))}
              </span>
            )
          )}
        </fieldset>
      </div>
      <p id={hintId} key={hint} className="ah-fade mt-2 text-xs leading-5 text-yearbook-muted">
        {hint}
      </p>
    </>
  );
};
