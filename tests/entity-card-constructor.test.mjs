import fs from 'node:fs';
import assert from 'node:assert/strict';
import { ENTITY_CARD_LINE_COUNT, normalizeEntityCardAppearance, entityVisualCard } from '../ui/cards/entity-card-constructor.js';
import { profileCardAppearance, profileCardFields, workplaceCardAppearance, workplaceCardFields } from '../core/profile/card-presentation.js';

assert.equal(ENTITY_CARD_LINE_COUNT, 9);

const normalized = normalizeEntityCardAppearance({
  lines: [{ field:'name', zone:'right', align:'center', size:'xl', color:'black', bold:true, italic:true, underline:true, uppercase:true }],
});
assert.equal(normalized.lines.length, 9);
assert.deepEqual(normalized.lines[0], {
  field:'name', zone:'right', align:'center', size:'xl', color:'black',
  bold:true, italic:true, underline:true, uppercase:true,
});

const profile={name:'Александр',surname:'Волоковых',profession:'Практик',phone:'+79104193490',emails:['a@example.com'],telegrams:['alex'],experience:'20 лет',professionAbout:'Описание'};
const workplace={name:'Бьюти тория',from:'12:00',to:'21:00',city:'Москва'};
const profileAppearance=profileCardAppearance(profile);
const profileFields=profileCardFields(profile,[workplace]);
assert.equal(profileAppearance.lines[0].field,'workTime');
assert.equal(profileAppearance.lines[1].field,'workplaceName');
assert.equal(profileAppearance.lines[6].field,'name');
assert.equal(profileAppearance.lines[7].field,'profession');
assert.equal(profileAppearance.lines[8].field,'phone');
assert.ok(profileFields.some((item)=>item.value==='email'&&item.text==='a@example.com'));
assert.ok(profileFields.some((item)=>item.value==='telegram'&&item.text==='alex'));

const workplaceAppearance=workplaceCardAppearance(workplace);
const workplaceFields=workplaceCardFields(workplace,profile);
assert.equal(workplaceAppearance.lines.length,9);
assert.ok(workplaceFields.some((item)=>item.value==='profileName'));
assert.ok(workplaceFields.some((item)=>item.value==='profileEmail'&&item.text==='a@example.com'));

const html=entityVisualCard({appearance:profileAppearance,fields:profileFields});
assert.match(html,/entity-visual-card/);
assert.match(html,/12:00 - 21:00/);
assert.match(html,/Бьюти тория/);
assert.match(html,/Александр Волоковых/);
assert.equal((html.match(/data-entity-card-line=/g)||[]).length,9);

const css=fs.readFileSync(new URL('../ui/cards/entity-card-constructor.css',import.meta.url),'utf8');
assert.match(css,/width:min\(338px,100%\)/);
assert.match(css,/aspect-ratio:338\/213/);
assert.match(css,/v2-profile-workplaces>\.entity-visual-card/);

const profileSource=fs.readFileSync(new URL('../core/profile/profile.js',import.meta.url),'utf8');
const workplaceSource=fs.readFileSync(new URL('../core/profile/workplaces/workplaces.js',import.meta.url),'utf8');
const constructorSource=fs.readFileSync(new URL('../ui/cards/entity-card-constructor.js',import.meta.url),'utf8');
const appearanceQSource=fs.readFileSync(new URL('../ui/cards/appearance-q.js',import.meta.url),'utf8');
const v2Source=['index.js','shell.js','swipe.js','workspace-navigation.js'].map((file)=>fs.readFileSync(new URL(`../ui/v2/${file}`,import.meta.url),'utf8')).join('\n');
const inputCss=fs.readFileSync(new URL('../ui/inputs/inputs.css',import.meta.url),'utf8');
const colorSource=fs.readFileSync(new URL('../ui/colors/index.js',import.meta.url),'utf8');

assert.match(profileSource,/entityVisualCard\(/);
assert.doesNotMatch(profileSource,/entity-card--hero/);
assert.match(profileSource,/openEntityCardAppearanceQ\(root/);
assert.match(profileSource,/Все рабочие пространства/);
assert.doesNotMatch(profileSource,/mountEntityCardConstructor\(/);
assert.doesNotMatch(profileSource,/modal--entity-card-constructor/);

assert.doesNotMatch(workplaceSource,/openWorkplaceAppearance\(/);
assert.doesNotMatch(workplaceSource,/mountEntityCardConstructor\(/);
assert.doesNotMatch(workplaceSource,/label:'Вид'/);
assert.match(appearanceQSource,/variant: 'q'/);
assert.match(appearanceQSource,/mountEntityCardConstructor\(constructor/);
assert.match(appearanceQSource,/data-entity-card-appearance-type/);

assert.match(constructorSource,/select\(\{/);
assert.match(constructorSource,/colorPicker\(\{/);
assert.match(constructorSource,/rangeField\(\{/);
assert.doesNotMatch(constructorSource,/data-card-save|v2-primary-source-only|data-v2-primary-action/);
assert.match(constructorSource,/onStateChange/);
assert.match(appearanceQSource,/data-card-q-save/);
assert.match(appearanceQSource,/controller\?\.save\?\.\(\)/);
assert.match(constructorSource,/data-card-photo-select/);
assert.doesNotMatch(constructorSource,/type="color"/);

assert.match(v2Source,/edgeWidth = 36/);
assert.match(v2Source,/data-v2-edge-swipe/);
assert.match(v2Source,/if \(Number\(event\.clientX \|\| 0\) > rect\.left \+ edgeWidth\) return/);
assert.doesNotMatch(v2Source,/forceNavigation|nestedHorizontalScroller|event\.target\.closest\?\.\('button,input,select,textarea,label/);
assert.match(inputCss,/background:#ffff00/);
assert.match(inputCss,/::-webkit-slider-thumb/);
assert.match(colorSource,/#FFFF00/);
assert.match(colorSource,/#FF1111/);
assert.match(colorSource,/variant: 'x'/);

console.log('entity card constructor tests passed');
