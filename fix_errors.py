with open('lib/marketing-media/agents/executors.ts', 'r') as f:
    content = f.read()
content = content.replace('generateConceptForTemplate(templateId as any', 'generateConceptForTemplate(templateId as any')
content = content.replace('c.script || {}', 'c.script ? (c.script as any) : {}')
with open('lib/marketing-media/agents/executors.ts', 'w') as f:
    f.write(content)
print('patched executors via python')
