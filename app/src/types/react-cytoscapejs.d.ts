declare module "react-cytoscapejs" {
  import React from "react";
  import cytoscape from "cytoscape";

  interface CytoscapeComponentProps {
    elements: cytoscape.ElementDefinition[];
    style?: React.CSSProperties;
    stylesheet?: cytoscape.StyleDefinition[];
    layout?: cytoscape.LayoutOptions;
    cy?: (cy: cytoscape.Core) => void;
    wheelSensitivity?: number;
  }

  const CytoscapeComponent: React.FC<CytoscapeComponentProps>;
  export default CytoscapeComponent;
}
