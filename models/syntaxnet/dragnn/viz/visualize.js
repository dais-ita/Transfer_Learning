
/**
 * @fileoverview This file is the main entrypoint for DRAGNN trace
 * visualization. The main function that it exposes is visualizeToDiv(), which
 * it will save to `window` (supposing `window` is defined).
 */
const cytoscape = require('cytoscape');
const _ = require('lodash');

// Legacy JS, downloaded in the Dockerfile from github. This generates
// colorblind-friendly color palettes, for a variable number of components.
//
// This library consumes 27kb minified-but-uncompressed. Currently we mostly
// serve JS to high-bandwidth clients like IPython, but if minified size is ever
// a concern, it should be fairly easy to pre-compute our color palettes.
const palette = require('exports-loader?palette!../palette.js');

// Register our custom DRAGNN layout class.
const DragnnLayout = require('./dragnn_layout.js');
cytoscape('layout', 'dragnn', DragnnLayout);

import preact from 'preact';
import InteractiveGraph from './interactive_graph.jsx';
import setupTraceInteractionHandlers from './trace_interaction_handlers';

// Helper class to build a Cytoscape graph from a DRAGNN master spec.
class DragnnCytoscapeGraphBuilder {
  /**
   * Creates a new DragnnCytoscapeGraphBuilder.
   */
  constructor() {
    this.graph = {nodes: [], edges: []};
    this.nodesWithoutCaptions = 0;
  }

  /**
   * Adds a new component node to the graph. Component nodes represent
   * components in DRAGNN, which often resemble tasks (tagging, parsing, etc.).
   *
   * @param {!Object} component Component descriptor from the master spec.
   */
  addComponentNode(component) {
    this.graph.nodes.push({
      'data': {
        'id': component.name,
        'idx': component.idx,
        'componentColor': '#' + component.color,
        'text': component.name,
        'type': 'component',
      },
      'classes': 'component',
    });
  }

  /**
   * Adds a new step node to the graph. Step nodes are generated by unrolling a
   * component on a concrete example.
   *
   * @param {!Object} component Component descriptor from the master spec.
   * @param {!Object} step Step descriptor from the master spec.
   * @return {string} ID fo the node created.
   */
  addNode(component, step) {
    const graphId = component.name + '-' + step.idx;

    this.graph.nodes.push({
      'data': {
        'id': graphId,
        'componentIdx': component.idx,
        'stepIdx': step.idx,
        'parent': component.name,
        'text': step.caption || graphId,
        'componentColor': '#' + component.color,
        'type': 'step',

        // Shown in the mouse-over (node_info.jsx).
        'stateInfo': step.html_representation,
        'fixedFeatures': step.fixed_feature_trace,
      },
      'classes': 'step',
    });
    return graphId;
  }

  /**
   * Adds a list of components from the master spec.
   *
   * This function generates colors, and calls addComponent().
   *
   * @param {!Object} masterTrace Master trace proto from DRAGNN.
   */
  addComponents(masterTrace) {
    const colors = palette('tol', masterTrace.component_trace.length);
    if (colors == null) {
      // Apparently palette.js can fail with > 12 components or such.
      window.alert('FAILURE -- YOU HAVE TOO MANY COMPONENTS FOR palette.js.');
      return;
    }
    _.each(masterTrace.component_trace, function(component, idx) {
      component.idx = idx;
      component.color = colors[idx];
      this.addComponent(component);
    }.bind(this));
    console.log('' + this.nodesWithoutCaptions + ' nodes without captions');
  }

  /**
   * Adds one component from the master spec. This generates component nodes,
   * step nodes, and edges.
   *
   * @param {!Object} component Component descriptor from the master spec.
   */
  addComponent(component) {
    this.addComponentNode(component);

    _.each(component.step_trace, (step, idx) => {
      step.idx = idx;

      if (!step.caption) {
        this.nodesWithoutCaptions += 1;
        return;
      }

      const graphId = this.addNode(component, step);

      _.each(step.linked_feature_trace, (linkedFeature) => {
        // Each feature can take multiple values.
        _.each(linkedFeature.value_trace, (linkedValue) => {
          const srcGraphId =
              linkedFeature.source_component + '-' + linkedValue.step_idx;
          this.graph.edges.push({
            'data': {
              'source': srcGraphId,
              'target': graphId,
              'curvature': 0,
              'featureName': linkedValue.feature_name,
              'featureValue': linkedValue.feature_value,
            }
          });
        });
      });
    });
  }
}

/**
 * Component for a graph and its controls. Currently this just manually
 * calls DOM methods, but we'll switch it out for something more modern in a
 * sec.
 */
class InteractiveDragnnGraph {
  /**
   * Controller for the entire DRAGNN graph element on a page.
   *
   * @param {!Object} masterTrace Master trace proto from DRAGNN.
   * @param {!Object} element Container DOM element to populate.
   * @param {?Object} masterSpec Master spec proto from DRAGNN; if provided,
   *     used to improve the layout.
   */
  constructor(masterTrace, element, masterSpec) {
    this.masterTrace = masterTrace;
    this.element = element;
    this.masterSpec = masterSpec || null;
  }

  /**
   * Initializes the controls and the graph.
   */
  initDomElements() {
    this.element.style.position = 'relative';
    this.element.style.overflow = 'hidden';
    const elt = preact.h(InteractiveGraph, {
      onmount: (view, graph_elt) => {
        this.view = view;
        this.initializeGraph(view, graph_elt);
      },
      onfilter: this.onFilter.bind(this),
    });
    preact.render(elt, this.element);
  }

  /**
   * Handler for when filtering text is entered.
   *
   * Future features: Make the number of neighbors customizable.
   *
   * @param {string} text Regular expression text to filter with. Currently
   *     applied to node labels.
   */
  onFilter(text) {
    // Show relevant nodes (and parent components).
    const re = new RegExp(text);
    let sel = this.cy.$('node.step').filter(function(i, node) {
      return !text || node.data('text').match(re);
    });
    sel = sel.union(sel.neighborhood());
    sel = sel.union(sel.parents());
    sel.nodes().show();
    sel.abscomp().nodes().hide();

    // Redo layout.
    this.cy.layout({name: 'dragnn', masterSpec: this.masterSpec});
  }

  /**
   * Initializes the Cytoscape graph.
   */
  initializeGraph(view, domElement) {
    const builder = new DragnnCytoscapeGraphBuilder();
    builder.addComponents(this.masterTrace);

    const cy = cytoscape({
      container: domElement,
      boxSelectionEnabled: true,
      autounselectify: true,
      // We'll do more custom layout later.
      layout: {name: 'dragnn', masterSpec: this.masterSpec},
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(componentColor)',
            'content': 'data(text)',
            'text-halign': 'center',
            'text-opacity': 1.0,
            'text-valign': 'center',
          }
        },
        {
          selector: 'node.step',
          style: {
            'text-outline-width': 2,
            'text-outline-color': '#ffffff',
            'text-outline-opacity': 0.3,
          }
        },
        {
          selector: ':parent',
          style: {
            'background-opacity': 0.1,
            'text-halign': 'right',
            'text-margin-x': 5,
            'text-margin-y': 5,
            'text-valign': 'bottom',
          }
        },
        {
          selector: 'edge',
          style: {
            'control-point-distance': 'data(curvature)',
            'curve-style': 'unbundled-bezier',
            'line-color': '#666666',
            'opacity': 0.4,
            'target-arrow-color': '#666666',
            'target-arrow-shape': 'triangle',
            'width': 3,
          }
        },
        {selector: 'edge.faded-near', style: {'opacity': 0.2}},
        {selector: 'node.step.faded-near', style: {'opacity': 0.5}},
        {
          selector: 'node.step.faded-far, edge.faded-far',
          style: {'opacity': 0.1}
        },
        // Overall, override stuff for mouse-overs, but don't make the far edges
        // too dark (that looks jarring).
        {
          selector: 'edge.highlighted-edge',
          style: {'line-color': '#333333', 'opacity': 1.0}
        },
        {
          selector: 'edge.highlighted-edge.faded-far',
          style: {
            'opacity': 0.4,
          }
        },
      ],
      elements: builder.graph,
    });
    this.cy = cy;
    setupTraceInteractionHandlers(cy, view, this.element);
  }
}

/**
 * This is the external interface. See "index.html" for the development example,
 * which downloads graph data from a JSON file.  In most iPython notebook
 * situations, the script tag containing the graph definition will be generated
 * inline.
 *
 * @param {!Object} masterTrace Master trace proto from DRAGNN.
 * @param {string} divId ID of the page element to populate with the graph.
 * @param {?Object} masterSpec Master spec proto from DRAGNN; if provided, used
 *     to improve the layout.
 */

const visualizeToDiv = function(masterTrace, divId, masterSpec) {
  const interactiveGraph = new InteractiveDragnnGraph(
      masterTrace, document.getElementById(divId), masterSpec);
  interactiveGraph.initDomElements();
};

if (window !== undefined) {
  window.visualizeToDiv = visualizeToDiv;
}

