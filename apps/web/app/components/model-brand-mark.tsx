export type ModelBrandId = 'all' | 'gpt' | 'claude' | 'google' | 'deepseek' | 'glm' | 'other';

type ModelBrandMarkProps = {
  brand: ModelBrandId;
  className?: string;
  label?: string;
  mark: string;
};

const MODEL_BRAND_LOGOS: Partial<Record<ModelBrandId, { alt: string; src: string }>> = {
  claude: { alt: 'Claude', src: '/model-brands/claude.png' },
  deepseek: { alt: 'DeepSeek', src: '/model-brands/deepseek.png' },
  glm: { alt: 'GLM', src: '/model-brands/glm.png' },
  google: { alt: 'Gemini', src: '/model-brands/gemini.png' },
  gpt: { alt: 'GPT', src: '/model-brands/gpt.png' }
};

export function ModelBrandMark({ brand, className = '', label, mark }: ModelBrandMarkProps) {
  const logo = MODEL_BRAND_LOGOS[brand];
  const classes = ['experience-brand-mark', brand, logo ? 'has-logo' : '', className].filter(Boolean).join(' ');

  return (
    <span aria-label={label ?? logo?.alt ?? mark} className={classes} title={label ?? logo?.alt ?? mark}>
      {logo ? <img alt="" aria-hidden="true" src={logo.src} /> : mark}
    </span>
  );
}
