Q3D.gui = {

  type: "dat-gui",

  parameters: {
    lyr: [],
    cp: {
      c: "#ffffff",
      d: 0,
      o: 1,
      l: false
    },
    cmd: {         // commands for touch screen devices
      rot: false,  // auto rotation
      wf: false    // wireframe mode
    },
    i: Q3D.application.showInfo,
    FOTsearch: '0000000000',
    Source: 'https://dl.dropboxusercontent.com/s/8qyigf5hvqmty0z/csvtest1.csv?dl=1',
    getParseResult: getAllData,
    getParseSources: getSources,
    getbounds: "http://wfs-kbhkort.kk.dk/k101/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=k101:storbyhaver&outputFormat=json",
    WFSlayers: [],
    opacity: 1.0,
    color: "#445566",
    height: 5,
    random: false,
  },

  // initialize gui
  // - setupDefaultItems: default is true
  init: function (setupDefaultItems) {
    this.gui = new dat.GUI();
    this.gui.domElement.parentElement.style.zIndex = 1000;   // display the panel on the front of labels
    if (setupDefaultItems === undefined || setupDefaultItems == true) {
      this.addLayersFolder();
      this.addCustomPlaneFolder();
      this.addFunctionsFolder();
     // this.addCustomLayers();
      if (Q3D.isTouchDevice) this.addCommandsFolder();
      this.addHelpButton();
    }
  },

  addLoadingButtons: function () {
      var dataFolder = this.gui.addFolder('Data Management');
      dataFolder.add('Load');
      /*
      dataFolder.add(parameters.lyr[i], 'Load').name('Load').onChange(function (value) {
          var file = File("./randdata.csv");
          Papa.parse(file, {
              complete: function (results) {
                  console.log(results);
              }
          });
      }); */
  },

  addLayersFolder: function () {
    var parameters = this.parameters;
    var layersFolder = this.gui.addFolder('Layers');

    var visibleChanged = function (value) { project.layers[this.object.i].setVisible(value); };
    var opacityChanged = function (value) { project.layers[this.object.i].setOpacity(value); };
    var sideVisibleChanged = function (value) { project.layers[this.object.i].setSideVisibility(value); };

    project.layers.forEach(function (layer, i) {
      parameters.lyr[i] = {i: i, v: layer.visible, o: layer.opacity};
      var folder = layersFolder.addFolder(layer.name);
      folder.add(parameters.lyr[i], 'v').name('Visible').onChange(visibleChanged);

      if (layer.type == Q3D.LayerType.DEM) {
        var itemName = '';
        if (layer.blocks[0].sides) itemName = 'Sides and bottom';
        else if (layer.blocks[0].frame) itemName = 'Frame';

        if (itemName) {
          parameters.lyr[i].sv = true;
          folder.add(parameters.lyr[i], 'sv').name(itemName).onChange(sideVisibleChanged);
        }
      }
      else if (layer.type == Q3D.LayerType.Polygon && layer.objType == 'Overlay') {
        var j, f = layer.f, m = f.length;
        for (j = 0; j < m; j++) {
          if (f[j].mb === undefined) continue;
          parameters.lyr[i].border = true;
          folder.add(parameters.lyr[i], 'border').name('Borders').onChange(function (value) {
            project.layers[this.object.i].setBorderVisibility(value);
          });
          break;
        }

        for (j = 0; j < m; j++) {
          if (f[j].ms === undefined) continue;
          parameters.lyr[i].side = true;
          folder.add(parameters.lyr[i], 'side').name('Sides').onChange(function (value) {
            project.layers[this.object.i].setSideVisibility(value);
          });
          break;
        }
      }

      folder.add(parameters.lyr[i], 'o').min(0).max(1).name('Opacity').onChange(opacityChanged);
     
    });
  },

  addCustomPlaneFolder: function () {
    var customPlane;
    var parameters = this.parameters;
    var addPlane = function (color) {
      // Add a new plane in the current scene
      var geometry = new THREE.PlaneBufferGeometry(project.width, project.height, 1, 1),
          material = new THREE.MeshLambertMaterial({color: color, transparent: true});
      if (!Q3D.isIE) material.side = THREE.DoubleSide;
      customPlane = new THREE.Mesh(geometry, material);
      Q3D.application.scene.add(customPlane);
    };

    // Min/Max value for the plane
    var zMin = (project.layers[0].type == Q3D.LayerType.DEM) ? project.layers[0].stats.min - 500 : 0,
        zMax = (project.layers[0].type == Q3D.LayerType.DEM) ? project.layers[0].stats.max + 1000 : 9000;
    parameters.cp.d = zMin;

    // Create Custom Plane folder
    var folder = this.gui.addFolder('Custom Plane');

    // Plane color
    folder.addColor(parameters.cp, 'c').name('Color').onChange(function (value) {
      if (customPlane === undefined) addPlane(parameters.cp.c);
      customPlane.material.color.setStyle(value);
    });

    // Plane height
    folder.add(parameters.cp, 'd').min(zMin).max(zMax).name('Plane height').onChange(function (value) {
      if (customPlane === undefined) addPlane(parameters.cp.c);
      customPlane.position.z = (value + project.zShift) * project.zScale;
      customPlane.updateMatrixWorld();
    });

    // Plane opacity
    folder.add(parameters.cp, 'o').min(0).max(1).name('Opacity (0-1)').onChange(function (value) {
      if (customPlane === undefined) addPlane(parameters.cp.c);
      customPlane.material.opacity = value;
    });

    // Enlarge plane option
    folder.add(parameters.cp, 'l').name('Enlarge').onChange(function (value) {
      if (customPlane === undefined) addPlane(parameters.cp.c);
      if (value) customPlane.scale.set(10, 10, 1);
      else customPlane.scale.set(1, 1, 1);
      customPlane.updateMatrixWorld();
    });
  },

  // add commands folder for touch screen devices
  addCommandsFolder: function () {
    var folder = this.gui.addFolder('Commands');
    if (Q3D.Controls.type == "OrbitControls") {
      folder.add(this.parameters.cmd, 'rot').name('Auto Rotation').onChange(function (value) {
        Q3D.application.controls.autoRotate = value;
      });
    }
    folder.add(this.parameters.cmd, 'wf').name('Wireframe Mode').onChange(Q3D.application.setWireframeMode);
  },

  addFunctionsFolder: function () {
      var parameters = this.parameters;
      var funcFolder = this.gui.addFolder('Functions');


      funcFolder.add(this.parameters, 'FOTsearch').name('Search for FOT').onFinishChange(function (value) {
          Q3D.application.searchBuilding(value); //Kalder til qgis2threejs.js med v�rdien fra feltet
      });
      
      funcFolder.add(this.parameters, 'getbounds').name('Get Bounds!').onFinishChange(function (value) { Q3D.application.getbounds(value) }); //Kalder til qgis2threejs.js med v�rdien fra feltet

     
      /*
      funcFolder.add(this.parameters, 'Source').name('Select Data Source').onFinishChange(function (value) {
          Papa.parse(value, {
              download: true,
              header: true,
              error: function(error, file){
                  alert(error);
              },
              complete: function(results) {
                console.log("Parsing complete:", results);
                  Q3D.application.csvResults = results;
              }
          })
      })
      */
      funcFolder.add(this.parameters, 'Source').name('Select Data Source').onFinishChange(function (value) {
          addSource(value);
          startParse();
      }),

      funcFolder.add(this.parameters, 'getParseResult').name('Retrieve Data');
      funcFolder.add(this.parameters, 'getParseSources').name('Retrive Sources').onChange(function () {console.log(getSources())});
  },



  addCustomLayers: function (layer) {
      var parameters = this.parameters;
      parameters.WFSlayers = layer;

      var wfsFolder = this.gui.addFolder('WFS Layers');

      //Change Opacity
      wfsFolder.add(parameters, 'opacity').name('Show Layer').min(0).max(1).name('Opacity (0-1)').onChange(function (opacityValue) {

          for (var i = 0; i < parameters.WFSlayers.model.length; i++) {
              console.log("Setting invisible");
              parameters.WFSlayers.model[i].material.transparent = true;
              parameters.WFSlayers.model[i].material.opacity = opacityValue;
          }
      });
      //Change Color
      wfsFolder.addColor(parameters, 'color').name('Color').onChange(function (color) {
          console.log(color);
          for (var i = 0; i < parameters.WFSlayers.model.length; i++) {
              console.log("Setting invisible");
              color = color.replace('#', '0x');
              parameters.WFSlayers.model[i].material.color.setHex(color);
          
          }
      });
      //Change height
      wfsFolder.add(parameters, 'height').name('Height').min(1).max(15).onChange(function (height) {
          
          for (var i = 0; i < parameters.WFSlayers.model.length; i++) {
              parameters.WFSlayers.model[i].scale.set(1, 1, height);
          }
      });

      //Change Randomize Height
      wfsFolder.add(parameters, 'random').name('Random Height').onChange(function () {

          for (var i = 0; i < parameters.WFSlayers.model.length; i++) {
              parameters.WFSlayers.model[i].scale.set(1, 1, 10*Math.random() + 20);
          }
      });
      
  },

  addHelpButton: function () {
    this.gui.add(this.parameters, 'i').name('Help');
  }


};
