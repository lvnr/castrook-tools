from pathlib import Path
import yaml

skills = list(Path('skills').glob('*/SKILL.md'))
assert len(skills) == 4
for path in skills:
    _, metadata, body = path.read_text().split('---', 2)
    fields = yaml.safe_load(metadata)
    assert fields['name'] == path.parent.name
    assert fields['description'] and len(fields['description']) <= 1024
    assert 'https://castrook.com' in body
    config = yaml.safe_load((path.parent / 'agents/openai.yaml').read_text())
    assert config['interface']['default_prompt']
print('Validated four installable skills.')
