/**
 * @license Copyright 2017 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
/**
  * @fileoverview Gathers all images used on the page with their src, size,
  *   and attribute information. Executes script in the context of the page.
  */
'use strict';

const Gatherer = require('./gatherer.js');
const pageFunctions = require('../../lib/page-functions.js');
const Driver = require('../driver.js'); // eslint-disable-line no-unused-vars
const FontSize = require('./seo/font-size.js');

/* global window, getElementsInDocument, Image, getNodePath, getNodeSelector, getNodeLabel, getOuterHTMLSnippet, ShadowRoot */


/** @param {Element} element */
/* istanbul ignore next */
function getClientRect(element) {
  const clientRect = element.getBoundingClientRect();
  return {
    // Just grab the DOMRect properties we want, excluding x/y/width/height
    top: clientRect.top,
    bottom: clientRect.bottom,
    left: clientRect.left,
    right: clientRect.right,
  };
}

/**
 * @param {Array<Element>} allElements
 * @return {Array<LH.Artifacts.ImageElement>}
 */
/* istanbul ignore next */
function getHTMLImages(allElements) {
  const allImageElements = /** @type {Array<HTMLImageElement>} */ (allElements.filter(element => {
    return element.localName === 'img';
  }));

  return allImageElements.map(element => {
    const computedStyle = window.getComputedStyle(element);
    return {
      // currentSrc used over src to get the url as determined by the browser
      // after taking into account srcset/media/sizes/etc.
      src: element.currentSrc,
      srcset: element.srcset,
      displayedWidth: element.width,
      displayedHeight: element.height,
      clientRect: getClientRect(element),
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      attributeWidth: element.getAttribute('width') || '',
      attributeHeight: element.getAttribute('height') || '',
      cssWidth: '', // this will get overwritten below
      cssHeight: '', // this will get overwritten below
      isCss: false,
      // @ts-expect-error: loading attribute not yet added to HTMLImageElement definition.
      loading: element.loading,
      resourceSize: 0, // this will get overwritten below
      isPicture: !!element.parentElement && element.parentElement.tagName === 'PICTURE',
      usesObjectFit: ['cover', 'contain', 'scale-down', 'none'].includes(
        computedStyle.getPropertyValue('object-fit')
      ),
      usesPixelArtScaling: ['pixelated', 'crisp-edges'].includes(
        computedStyle.getPropertyValue('image-rendering')
      ),
      isShadow: element.getRootNode() instanceof ShadowRoot,
      // https://html.spec.whatwg.org/multipage/images.html#pixel-density-descriptor
      usesSrcSetDensityDescriptor: / \d+(\.\d+)?x/.test(element.srcset),
      // @ts-ignore - getNodePath put into scope via stringification
      devtoolsNodePath: getNodePath(element),
      // @ts-ignore - put into scope via stringification
      selector: getNodeSelector(element),
      // @ts-ignore - put into scope via stringification
      nodeLabel: getNodeLabel(element),
      // @ts-ignore - put into scope via stringification
      snippet: getOuterHTMLSnippet(element),
    };
  });
}

/**
 * @param {Array<Element>} allElements
 * @return {Array<LH.Artifacts.ImageElement>}
 */
/* istanbul ignore next */
function getCSSImages(allElements) {
  // Chrome normalizes background image style from getComputedStyle to be an absolute URL in quotes.
  // Only match basic background-image: url("http://host/image.jpeg") declarations
  const CSS_URL_REGEX = /^url\("([^"]+)"\)$/;

  /** @type {Array<LH.Artifacts.ImageElement>} */
  const images = [];

  for (const element of allElements) {
    const style = window.getComputedStyle(element);
    // If the element didn't have a CSS background image, we're not interested.
    if (!style.backgroundImage || !CSS_URL_REGEX.test(style.backgroundImage)) continue;

    const imageMatch = style.backgroundImage.match(CSS_URL_REGEX);
    // @ts-expect-error test() above ensures that there is a match.
    const url = imageMatch[1];

    images.push({
      src: url,
      srcset: '',
      displayedWidth: element.clientWidth,
      displayedHeight: element.clientHeight,
      clientRect: getClientRect(element),
      // CSS Images do not expose natural size, we'll determine the size later
      naturalWidth: 0,
      naturalHeight: 0,
      attributeWidth: '',
      attributeHeight: '',
      cssWidth: '',
      cssHeight: '',
      isCss: true,
      isPicture: false,
      isShadow: element.getRootNode() instanceof ShadowRoot,
      usesObjectFit: false,
      usesPixelArtScaling: ['pixelated', 'crisp-edges'].includes(
        style.getPropertyValue('image-rendering')
      ),
      usesSrcSetDensityDescriptor: false,
      resourceSize: 0, // this will get overwritten below
      // @ts-ignore - getNodePath put into scope via stringification
      devtoolsNodePath: getNodePath(element),
      // @ts-ignore - put into scope via stringification
      selector: getNodeSelector(element),
      // @ts-ignore - put into scope via stringification
      nodeLabel: getNodeLabel(element),
      // @ts-ignore - put into scope via stringification
      snippet: getOuterHTMLSnippet(element),
    });
  }

  return images;
}

/** @return {Array<LH.Artifacts.ImageElement>} */
/* istanbul ignore next */
function collectImageElementInfo() {
  /** @type {Array<Element>} */
  // @ts-expect-error - added by getElementsInDocumentFnString
  const allElements = getElementsInDocument();
  return getHTMLImages(allElements).concat(getCSSImages(allElements));
}

/**
 * @param {string} url
 * @return {Promise<{naturalWidth: number, naturalHeight: number}>}
 */
/* istanbul ignore next */
function determineNaturalSize(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('error', _ => reject(new Error('determineNaturalSize failed img load')));
    img.addEventListener('load', () => {
      resolve({
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
    });

    img.src = url;
  });
}

/**
 * @param {LH.Crdp.CSS.CSSStyle} [style]
 * @param {string} property
 * @return {string | undefined}
 */
function findSizeDeclaration(style, property) {
  if (!style) return;
  const definedProp = style.cssProperties.find(({name}) => name === property);
  if (!definedProp) return;
  return definedProp.value;
}

/**
 * Finds the most specific directly matched CSS font-size rule from the list.
 *
 * @param {Array<LH.Crdp.CSS.RuleMatch>} [matchedCSSRules]
 * @param {string} property
 * @returns {string | undefined}
 */
function findMostSpecificMatchedCSSRule(matchedCSSRules = [], property) {
  let maxSpecificity = -Infinity;
  /** @type {LH.Crdp.CSS.CSSRule|undefined} */
  let maxSpecificityRule;

  for (const {rule, matchingSelectors} of matchedCSSRules) {
    // hasSizeDeclaration from font-size.js using `.some()`
    if (!!rule.style && rule.style.cssProperties.some(({name}) => name === property)) {
      const specificities = matchingSelectors.map(idx =>
        FontSize.computeSelectorSpecificity(rule.selectorList.selectors[idx].text)
      );
      const specificity = Math.max(...specificities);
      // Use greater OR EQUAL so that the last rule wins in the event of a tie
      if (specificity >= maxSpecificity) {
        maxSpecificity = specificity;
        maxSpecificityRule = rule;
      }
    }
  }

  if (maxSpecificityRule) {
    // @ts-ignore the existence of the property object is checked in the for loop
    return maxSpecificityRule.style.cssProperties.find(({name}) => name === property).value;
  }
}

/**
 * @param {LH.Crdp.CSS.GetMatchedStylesForNodeResponse} matched CSS rules}
 * @param {string} property
 * @returns {string | undefined}
 */
function getEffectiveSizingRule({attributesStyle, inlineStyle, matchedCSSRules}, property) {
  // CSS sizing can't be inherited
  // We only need to check inline & matched styles
  // Inline styles have highest priority
  const inlineRule = findSizeDeclaration(inlineStyle, property);
  if (inlineRule) return inlineRule;

  const attributeRule = findSizeDeclaration(attributesStyle, property);
  if (attributeRule) return attributeRule;
  // Rules directly referencing the node come next
  const matchedRule = findMostSpecificMatchedCSSRule(matchedCSSRules, property);
  if (matchedRule) return matchedRule;
}

class ImageElements extends Gatherer {
  constructor() {
    super();
    /** @type {Map<string, {naturalWidth: number, naturalHeight: number}>} */
    this._naturalSizeCache = new Map();
  }

  /**
   * @param {Driver} driver
   * @param {LH.Artifacts.ImageElement} element
   * @return {Promise<LH.Artifacts.ImageElement>}
   */
  async fetchElementWithSizeInformation(driver, element) {
    const url = JSON.stringify(element.src);
    if (this._naturalSizeCache.has(url)) {
      return Object.assign(element, this._naturalSizeCache.get(url));
    }

    try {
      // We don't want this to take forever, 250ms should be enough for images that are cached
      driver.setNextProtocolTimeout(250);
      /** @type {{naturalWidth: number, naturalHeight: number}} */
      const size = await driver.evaluateAsync(`(${determineNaturalSize.toString()})(${url})`);
      this._naturalSizeCache.set(url, size);
      return Object.assign(element, size);
    } catch (_) {
      // determineNaturalSize fails on invalid images, which we treat as non-visible
      return element;
    }
  }

  /**
   * @param {Driver} driver
   * @param {string} devtoolsNodePath
   * @param {LH.Artifacts.ImageElement} element
   */
  async fetchSourceRules(driver, devtoolsNodePath, element) {
    const {nodeId} = await driver.sendCommand('DOM.pushNodeByPathToFrontend', {
      path: devtoolsNodePath,
    });
    if (!nodeId) return;
    const matchedRules = await driver.sendCommand('CSS.getMatchedStylesForNode', {
      nodeId: nodeId,
    });
    const sourceWidth = getEffectiveSizingRule(matchedRules, 'width');
    const sourceHeight = getEffectiveSizingRule(matchedRules, 'height');
    const sourceRules = {cssWidth: sourceWidth, cssHeight: sourceHeight};
    Object.assign(element, sourceRules);
  }

  /**
   * @param {LH.Gatherer.PassContext} passContext
   * @param {LH.Gatherer.LoadData} loadData
   * @return {Promise<LH.Artifacts['ImageElements']>}
   */
  async afterPass(passContext, loadData) {
    const driver = passContext.driver;
    const indexedNetworkRecords = loadData.networkRecords.reduce((map, record) => {
      // The network record is only valid for size information if it finished with a successful status
      // code that indicates a complete resource response.
      if (/^image/.test(record.mimeType) && record.finished && record.statusCode === 200) {
        map[record.url] = record;
      }

      return map;
    }, /** @type {Object<string, LH.Artifacts.NetworkRequest>} */ ({}));

    const expression = `(function() {
      ${pageFunctions.getElementsInDocumentString}; // define function on page
      ${pageFunctions.getNodePathString};
      ${pageFunctions.getNodeSelectorString};
      ${pageFunctions.getNodeLabelString};
      ${pageFunctions.getOuterHTMLSnippetString};
      ${getClientRect.toString()};
      ${getHTMLImages.toString()};
      ${getCSSImages.toString()};
      ${collectImageElementInfo.toString()};

      return collectImageElementInfo();
    })()`;

    /** @type {Array<LH.Artifacts.ImageElement>} */
    const elements = await driver.evaluateAsync(expression);

    /** @type {Array<LH.Artifacts.ImageElement>} */
    const imageUsage = [];
    const top50Images = Object.values(indexedNetworkRecords)
      .sort((a, b) => b.resourceSize - a.resourceSize)
      .slice(0, 50);
    await Promise.all([
      driver.sendCommand('DOM.enable'),
      driver.sendCommand('CSS.enable'),
      driver.sendCommand('DOM.getDocument', {depth: -1, pierce: true}),
    ]);

    for (let element of elements) {
      // Pull some of our information directly off the network record.
      const networkRecord = indexedNetworkRecords[element.src] || {};
      element.mimeType = networkRecord.mimeType;
      // Resource size is almost always the right one to be using because of the below:
      //     transferSize = resourceSize + headers.length
      // HOWEVER, there are some cases where an image is compressed again over the network and transfer size
      // is smaller (see https://github.com/GoogleChrome/lighthouse/pull/4968).
      // Use the min of the two numbers to be safe.
      const {resourceSize = 0, transferSize = 0} = networkRecord;
      element.resourceSize = Math.min(resourceSize, transferSize);
      if (!element.isShadow) {
        await this.fetchSourceRules(driver, element.devtoolsNodePath, element);
      }
      // Images within `picture` behave strangely and natural size information isn't accurate,
      // CSS images have no natural size information at all. Try to get the actual size if we can.
      // Additional fetch is expensive; don't bother if we don't have a networkRecord for the image,
      // or it's not in the top 50 largest images.
      if (
        (element.isPicture || element.isCss || element.srcset) &&
        networkRecord &&
        top50Images.includes(networkRecord)
      ) {
        element = await this.fetchElementWithSizeInformation(driver, element);
      }
      imageUsage.push(element);
    }

    await Promise.all([
      driver.sendCommand('DOM.disable'),
      driver.sendCommand('CSS.disable'),
    ]);

    return imageUsage;
  }
}

module.exports = ImageElements;
