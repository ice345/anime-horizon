import React, { useRef, useState } from 'react';
import {
  clearSessionAIConfig,
  DEFAULT_DEEPSEEK_ENDPOINT,
  DEFAULT_DEEPSEEK_MODEL,
  getSessionAIConfig,
  SessionAIProvider,
  setSessionAIConfig,
} from '../services/geminiService';
import { useModalA11y } from '../hooks/useModalA11y';
import { useI18n } from '../shared/i18n/useI18n';
import { MessageKey, MessageParams } from '../shared/i18n/translate';

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AISettingsModal: React.FC<AISettingsModalProps> = ({ isOpen, onClose }) => {
  const [initialConfig] = useState(() => getSessionAIConfig());
  const [provider, setProvider] = useState<SessionAIProvider>(() => initialConfig?.provider || 'DEEPSEEK');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState(() => initialConfig?.endpoint || DEFAULT_DEEPSEEK_ENDPOINT);
  const [model, setModel] = useState(() => initialConfig?.model || DEFAULT_DEEPSEEK_MODEL);
  const [activeProvider, setActiveProvider] = useState<SessionAIProvider | null>(() => initialConfig?.provider || null);
  const { t } = useI18n();
  const [message, setMessage] = useState<{ key: MessageKey; params?: MessageParams } | null>(null);
  const providerName = (value: SessionAIProvider) =>
    t(value === 'DEEPSEEK' ? 'aiSettings.providerLabel.DEEPSEEK' : 'aiSettings.providerLabel.OPENAI_COMPATIBLE');
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalA11y(isOpen, onClose, dialogRef);

  if (!isOpen) return null;

  const changeProvider = (nextProvider: SessionAIProvider) => {
    setProvider(nextProvider);
    setMessage(null);
    if (nextProvider === 'DEEPSEEK') {
      setEndpoint(DEFAULT_DEEPSEEK_ENDPOINT);
      setModel(DEFAULT_DEEPSEEK_MODEL);
    }
  };

  const activatePersonalProvider = () => {
    if (!apiKey.trim() || !endpoint.trim() || !model.trim()) {
      setMessage({ key: 'aiSettings.missingFields' });
      return;
    }

    try {
      setSessionAIConfig({ provider, apiKey, endpoint, model });
      setApiKey('');
      setActiveProvider(provider);
      setMessage({ key: 'aiSettings.enabled', params: { provider: providerName(provider) } });
    } catch {
      setMessage({ key: 'aiSettings.invalid' });
    }
  };

  const returnToDefault = () => {
    clearSessionAIConfig();
    setApiKey('');
    setActiveProvider(null);
    setMessage({ key: 'aiSettings.restored' });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-settings-title"
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[var(--ah-radius-lg)] border border-yearbook-line bg-yearbook-surface shadow-[0_30px_90px_rgba(14,116,144,0.28)]"
      >
        <div className="sticky top-0 z-10 border-b border-yearbook-line bg-yearbook-blue/95 px-6 py-5 backdrop-blur">
          <div className="flex items-start justify-between gap-5">
            <div>
              <p className="ah-section-label">{t('aiSettings.eyebrow')}</p>
              <h2 id="ai-settings-title" className="mt-2 font-jp text-2xl font-medium text-yearbook-ink">
                {t('aiSettings.title')}
              </h2>
            </div>
            <button
              type="button"
              aria-label={t('aiSettings.close')}
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-full text-yearbook-muted transition hover:bg-white hover:text-yearbook-ink"
            >
              <span aria-hidden="true" className="text-2xl leading-none">
                ×
              </span>
            </button>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          <div
            className={`border p-4 ${activeProvider ? 'border-sky-200 bg-sky-50/70' : 'border-yearbook-line bg-yearbook-paper/60'}`}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-medium text-yearbook-ink">{t('aiSettings.current')}</h3>
                <p className="mt-1 text-sm text-yearbook-muted">
                  {activeProvider
                    ? t('aiSettings.personalActive', { provider: providerName(activeProvider) })
                    : t('aiSettings.siteDefault')}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${activeProvider ? 'bg-yearbook-sky text-white' : 'bg-yearbook-blue text-yearbook-muted'}`}
              >
                {activeProvider ? t('aiSettings.personalMode') : t('aiSettings.defaultMode')}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="session-ai-provider" className="block text-sm font-medium text-yearbook-ink">
              {t('aiSettings.provider')}
            </label>
            <select
              id="session-ai-provider"
              value={provider}
              onChange={(event) => changeProvider(event.target.value as SessionAIProvider)}
              className="w-full border border-yearbook-line bg-white px-3 py-3 text-sm text-yearbook-ink outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            >
              <option value="DEEPSEEK">{t('aiSettings.providerDeepSeek')}</option>
              <option value="OPENAI_COMPATIBLE">{t('aiSettings.providerCompatible')}</option>
            </select>
          </div>

          <div>
            <label htmlFor="session-ai-key" className="block text-sm font-medium text-yearbook-ink">
              {t('aiSettings.apiKey')}
            </label>
            <input
              id="session-ai-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={activeProvider ? t('aiSettings.apiKeyActive') : 'sk-...'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="mt-3 w-full border border-yearbook-line bg-white px-3 py-3 font-mono text-sm text-yearbook-ink outline-none transition placeholder:text-yearbook-muted/60 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px]">
            <div>
              <label htmlFor="session-ai-endpoint" className="block text-sm font-medium text-yearbook-ink">
                {t('aiSettings.endpoint')}
              </label>
              <input
                id="session-ai-endpoint"
                type="url"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-3 w-full border border-yearbook-line bg-white px-3 py-3 font-mono text-xs text-yearbook-ink outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>
            <div>
              <label htmlFor="session-ai-model" className="block text-sm font-medium text-yearbook-ink">
                {t('aiSettings.model')}
              </label>
              <input
                id="session-ai-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={t('aiSettings.modelPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="mt-3 w-full border border-yearbook-line bg-white px-3 py-3 font-mono text-xs text-yearbook-ink outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>
          </div>

          <p className="text-xs leading-5 text-yearbook-muted">{t('aiSettings.privacyNote')}</p>

          {message && (
            <p
              role="status"
              className="border-l-2 border-yearbook-sky bg-yearbook-blue/60 px-3 py-2 text-sm text-yearbook-ink"
            >
              {t(message.key, message.params)}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            {activeProvider && (
              <button
                type="button"
                onClick={returnToDefault}
                className="min-h-11 border border-yearbook-line px-4 text-sm font-medium text-yearbook-ink transition hover:bg-yearbook-blue"
              >
                {t('aiSettings.restoreDefault')}
              </button>
            )}
            <button
              type="button"
              onClick={activatePersonalProvider}
              className="min-h-11 bg-yearbook-sky px-4 text-sm font-medium text-white transition hover:bg-yearbook-sky-strong"
            >
              {activeProvider ? t('aiSettings.replace') : t('aiSettings.enable')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
