with open('lib/marketing-media/pipeline.ts', 'r') as f:
    content = f.read()
old = 'import { MARKETING_COLLECTIONS, MARKETING_PIPELINE_STAGES, MARKETING_DEFAULTS, DEMO_LABEL_TEXT } from "./collections";'
new = 'import { MARKETING_COLLECTIONS, MARKETING_PIPELINE_STAGES, MARKETING_DEFAULTS, DEMO_LABEL_TEXT, MarketingPipelineStage } from "./collections";'
content = content.replace(old, new)
with open('lib/marketing-media/pipeline.ts', 'w') as f:
    f.write(content)
print('patched pipeline import')
