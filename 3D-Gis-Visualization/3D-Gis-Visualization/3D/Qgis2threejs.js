"use strict";

// Qgis2threejs.js
// (C) 2014 Minoru Akagi | MIT License
// https://github.com/minorua/Qgis2threejs
//Export page edited and altered by Nicolai Mogensen and Adam Emil Paltorp Schmitt for DTU


var Q3D = { VERSION: "1.4" };
Q3D.Options = {
  bgcolor: null,
  light: {
    directional: {
      azimuth: 220,   // note: default light azimuth of gdaldem hillshade is 315.
      altitude: 65    // altitude angle
    }
  },
    side: { color: 0xc7ac92, bottomZ: -1.5 },
    frame: { color: 0, bottomZ: -1.5 },
    qmarker: { r: 0.25, c: 0xffff00, o: 0.8 },
  debugMode: false,
  exportMode: false,
  jsonLoader: "JSONLoader"  // JSONLoader or ObjectLoader
};

Q3D.LayerType = { DEM: "dem", Point: "point", Line: "line", Polygon: "polygon" };
Q3D.MaterialType = { MeshLambert: 0, MeshPhong: 1, LineBasic: 2, Sprite: 3, Unknown: -1 };
Q3D.uv = { i: new THREE.Vector3(1, 0, 0), j: new THREE.Vector3(0, 1, 0), k: new THREE.Vector3(0, 0, 1) };

Q3D.ua = window.navigator.userAgent.toLowerCase();
Q3D.isIE = (Q3D.ua.indexOf("msie") != -1 || Q3D.ua.indexOf("trident") != -1);
Q3D.isTouchDevice = ("ontouchstart" in window);

Q3D.$ = function (elementId) {
  return document.getElementById(elementId);
};

/*
Q3D.Project - Project data holder

params: title, crs, proj, baseExtent, rotation, width, zExaggeration, zShift, wgs84Center
*/
Q3D.Project = function (params) {
  for (var k in params) {
    this[k] = params[k];
  }

  var w = (this.baseExtent[2] - this.baseExtent[0]),
      h = (this.baseExtent[3] - this.baseExtent[1]);

  this.height = this.width * h / w;
  this.scale = this.width / w;
  this.zScale = this.scale * this.zExaggeration;

    this.origin = {
        x: this.baseExtent[0] + w / 2,
                 y: this.baseExtent[1] + h / 2,
        z: -this.zShift
    };

  this.layers = [];
  this.models = [];
  this.images = [];
};

Q3D.Project.prototype = {

  constructor: Q3D.Project,

  addLayer: function (layer) {
    layer.index = this.layers.length;
    layer.project = this;
    this.layers.push(layer);
    return layer;
  },

  layerCount: function () {
    return this.layers.length;
  },

  getLayerByName: function (name) {
    for (var i = 0, l = this.layers.length; i < l; i++) {
      var layer = this.layers[i];
      if (layer.name == name) return layer;
    }
    return null;
  },

  _rotatePoint: function (point, degrees, origin) {
    // Rotate point around the origin
    var theta = degrees * Math.PI / 180,
        c = Math.cos(theta),
        s = Math.sin(theta),
        x = point.x,
        y = point.y;

    if (origin) {
      x -= origin.x;
      y -= origin.y;
    }

    // rotate counter-clockwise
    var xd = x * c - y * s,
        yd = x * s + y * c;

    if (origin) {
      xd += origin.x;
      yd += origin.y;
    }
        return { x: xd, y: yd };
  },

  toMapCoordinates: function (x, y, z) {
    if (this.rotation) {
            var pt = this._rotatePoint({ x: x, y: y }, this.rotation);
      x = pt.x;
      y = pt.y;
    }
        return {
            x: x / this.scale + this.origin.x,
            y: y / this.scale + this.origin.y,
            z: z / this.zScale + this.origin.z
        };
  }
};


/*
Q3D.application

limitations:
- one renderer
- one scene
*/
(function () {
    // the application
    var app = {};
    Q3D.application = app;

    app.init = function (container) {
        
        //FPS Counter
        app.stats = new Stats();
        app.stats.setMode(0); // 0: fps, 1: ms, 2: mb

       
        // align top-left
        app.stats.domElement.style.position = 'absolute';
        app.stats.domElement.style.left = '0px';
        app.stats.domElement.style.top = '0px';

        document.body.appendChild(app.stats.domElement);

        app.INTERSECTED = null;
        app.mouse = new THREE.Vector2();
    
        app.container = container;
        app.running = false;
    
        // URL parameters
        app.urlParams = app.parseUrlParameters();
        if ("popup" in app.urlParams) {
            // open popup window
            var c = window.location.href.split("?");
            window.open(c[0] + "?" + c[1].replace(/&?popup/, ""), "popup", "width=" + app.urlParams.width + ",height=" + app.urlParams.height);
            app.popup.show("Another window has been opened.");
            return;
        }

        if (app.urlParams.width && app.urlParams.height) {
            // set container size
            container.style.width = app.urlParams.width + "px";
            container.style.height = app.urlParams.height + "px";
        }

        if (container.clientWidth && container.clientHeight) {
            app.width = container.clientWidth;
            app.height = container.clientHeight;
            app._fullWindow = false;
        } else {
            app.width = window.innerWidth;
            app.height = window.innerHeight;
            app._fullWindow = true;
        }

        // WebGLRendereraddcustom
        var bgcolor = Q3D.Options.bgcolor;
        app.renderer = new THREE.WebGLRenderer({ alpha: true , antialias: true});
        app.renderer.shadowMapEnabled = true;
        app.renderer.setSize(app.width, app.height);
        app.renderer.setClearColor(bgcolor || 0, (bgcolor === null) ? 0 : 1);
        app.container.appendChild(app.renderer.domElement);

        // scene
        app.scene = new THREE.Scene();
        app.scene.autoUpdate = true;
        //Fog
        app.scene.fog = new THREE.Fog(0xddddff, 0.1, 550);

        //Clickable objects that has attributes (buildings etc.)
        app._queryableObjects = [];
        app.queryObjNeedsUpdate = true;

        app.modelBuilders = [];
        app._wireframeMode = false;

      
        var url = "http://services.kortforsyningen.dk/service?servicename=topo_geo_gml2&VERSION=1.0.0&SERVICE=WFS&REQUEST=GetFeature&TYPENAME=kms:Bygning&login=student134859&password=3dgis&maxfeatures=5000";
        //app.getBuildings(xmin, ymin, xmax, ymax, 0, 0, url, "FOT Buildings");
        //Generate Buildings
        // app.getbounds("http://wfs-kbhkort.kk.dk/k101/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=k101:karre&outputFormat=json");
        // var request = "Bygning_BBR_P";
        // var url = "http://services.kortforsyningen.dk/service?servicename=topo_geo_gml2&VERSION=1.0.0&SERVICE=WFS&REQUEST=GetFeature&TYPENAME=kms:Navnefortidsminde&maxfeatures=3&login=student134859&password=3dgis&outputFormat=json";
        // app.getbounds(url);

    };

    app.parseUrlParameters = function () {
        var p, vars = {};
        var params = window.location.search.substring(1).split('&').concat(window.location.hash.substring(1).split('&'));
        params.forEach(function (param) {
            p = param.split('=');
            vars[p[0]] = p[1];
        });
        return vars;
    };

    /*
    Saves the current active project to appropriately formated JSON containing all information nescessary to rebuild it
    */
    app.saveProject = function (name) {
        var project = app.project;

        //vanilla project without any layers.
        var savedProject = {
            title: name,
            creator: "Builder",
            layers: [],
            crs: project.crs,
            origin: project.origin,
            baseExtent: project.baseExtent,
            height: project.height,
            width: project.width,
            scale: project.scale,
            zExaggeration: 1.5,
            zScale: 0.0606550748079256,
            zShift: 0,
        };

        /*
        Save the layers
        */
        project.layers.forEach(function (layer) {
            var models = [];
            var a = [];
            for (var i = 0; i < layer.model.length; i++) {

                var geo = new THREE.Geometry();
                geo.vertices = layer.model[i].geometry.vertices;
                geo.faces = layer.model[i].geometry.faces;
                layer.model[i].geometry = geo;
                var result = layer.model[i].toJSON();
                var resultJSON = JSON.stringify(result);
                models.push(resultJSON);
                a.push(layer.a[i]);
            }
            var layerJSON = { name: layer.name, type: layer.type, url: layer.url, model: models, a: a };
            savedProject.layers.push(layerJSON);
        });

        //Test how it goes
        var projectString = JSON.stringify(savedProject);
        //console.log(projectString);
        var projectParsed = JSON.parse(projectString);
        console.log(projectParsed);
        var projectJSON = projectParsed;
        var project = new Q3D.Project({
            crs: projectJSON.crs, title: projectJSON.title, baseExtent: projectJSON.baseExtent, rotation: projectJSON.rotation, zshift: projectJSON.zshift,
            width: projectJSON.width, height: projectJSON.height, zExaggeration: projectJSON.zExaggeration, layers: projectJSON.layers
        });
        project.layers = projectJSON.layers;
       

        var json = projectString;
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);

        var a = document.getElementById('djson');
        a.download = "backup.json";
        a.href = url;
        a.textContent = "Download backup.json";
        
        console.log(a);
        //Eventually when we are done, try to load the project (If done live, should just reload the entire scene correctly):
      //  app.loadProject(projectParsed);
    }
    /*
    Loads a project from a JSON formatted file (has to be called from saveProject) (Implement a verification method)
    */
    app.loadProject = function (projectJSON) {
        /*
              Rewrite this function to be able to load exported projects, and build the scene from that
              TODO 08-05-2016
              Nicolai
        */
        var project = new Q3D.Project({
            crs: projectJSON.crs, title: projectJSON.title, baseExtent: projectJSON.baseExtent, rotation: projectJSON.rotation, zshift: projectJSON.zshift,
            width: projectJSON.width, height: projectJSON.height, zExaggeration: projectJSON.zExaggeration, layers: projectJSON.layers,
        });
        project.map = {url: "http://kortforsyningen.kms.dk/service?servicename=orto_foraar&request=GetMap&service=WMS&version=1.1.1&LOGIN=student134859&PASSWORD=3dgis&layers=orto_foraar&format=image%2Fpng&srs=EPSG%3A25832"}
        project.layers = projectJSON.layers;
        //Since this method can be called again, we need to completely wipe the THREE.JS scene for any children, lights, cameras. as these will be set up
        //We wipe clean, because it might be in a later version, that lights and camera settings can be included in the project

        
            app.scene.children.forEach(function (child) {
                app.octree.remove(child);
                app.scene.remove(child);
                child = null;
           });
        
        app.project = project;

        // light
        if (project.buildCustomLights) project.buildCustomLights(app.scene);
        else app.buildDefaultLights(app.scene);

        // camera
        if (project.buildCustomCamera) project.buildCustomCamera();
        else app.buildDefaultCamera();

        app.raycaster = new THREE.Raycaster();

        app.octree = new THREE.Octree({
            // uncomment below to see the octree (may kill the fps)
            // scene: app.scene,
            // when undeferred = true, objects are inserted immediately
            // instead of being deferred until next octree.update() call
            // this may decrease performance as it forces a matrix update
            undeferred: false,
            // set the max depth of tree
            depthMax: 8,
            // max number of objects before nodes split or merge
            objectsThreshold: 128,
            // percent between 0 and 1 that nodes will overlap each other
            // helps insert objects that lie over more than one node
            overlapPct: 0.10
        });

        // restore view (camera position and its target) from URL parameters
        var vars = app.urlParams;
        if (vars.cx !== undefined) app.camera.position.set(parseFloat(vars.cx), parseFloat(vars.cy), parseFloat(vars.cz));
        if (vars.ux !== undefined) app.camera.up.set(parseFloat(vars.ux), parseFloat(vars.uy), parseFloat(vars.uz));
        if (vars.tx !== undefined) app.camera.lookAt(parseFloat(vars.tx), parseFloat(vars.ty), parseFloat(vars.tz));

        // controls
        if (Q3D.Controls) {
            app.controls = Q3D.Controls.create(app.camera, app.renderer.domElement);
            if (vars.tx !== undefined) {
                app.controls.target.set(parseFloat(vars.tx), parseFloat(vars.ty), parseFloat(vars.tz));
                app.controls.target0.copy(app.controls.target);   // for reset
            }
        }

        // load models (Experimental at this point)
        /*    if (project.models.length > 0) {
              project.models.forEach(function (model, index) {
                if (model.type == "COLLADA") {
                  app.modelBuilders[index] = new Q3D.ModelBuilder.COLLADA(app.project, model);
                }
                else if (Q3D.Options.jsonLoader == "ObjectLoader") {
                  app.modelBuilders[index] = new Q3D.ModelBuilder.JSONObject(app.project, model);
                }
                else {
                  app.modelBuilders[index] = new Q3D.ModelBuilder.JSON(app.project, model);
                }
              });
            } */

        // build models

        /* project.layers.forEach(function (layer) {
           layer.initMaterials();
           layer.build(app.scene);
         });
         */
        // wireframe mode setting
        if ("wireframe" in app.urlParams) app.setWireframeMode(true);

        // create a marker for queried point
        var opt = Q3D.Options.qmarker;
        app.queryMarker = new THREE.Mesh(new THREE.SphereGeometry(opt.r),
                                              new THREE.MeshLambertMaterial({ color: opt.c, ambient: opt.c, opacity: opt.o, transparent: (opt.o < 1) }));
        app.queryMarker.visible = false;
        app.scene.add(app.queryMarker);

        // update matrix world here
        app.scene.updateMatrixWorld();

        app.highlightMaterial = new THREE.MeshLambertMaterial({ emissive: 0x999900, transparent: true, opacity: 0.5 });
        if (!Q3D.isIE) app.highlightMaterial.side = THREE.DoubleSide;    // Shader compilation error occurs with double sided material on IE11

        app.selectedLayerId = null;
        app.selectedFeatureId = null;
        app.highlightObject = null;

        //Generate the plane
        app.calculatebbox(1);
        
        var loader = new THREE.ObjectLoader();
   
        project.layers.forEach(function (layer,i) {
            var models = [];
            layer.model.forEach(function (model) {
                var loadedGeometry = JSON.parse(model);
                var loadedMesh = loader.parse(loadedGeometry);
                models.push(loadedMesh);

                var position = { x: 0, y: -2 };
                var target = { x: 0, y: 0 };
                var tween = new TWEEN.Tween(position).to(target, 2000);

                tween.onUpdate(function () {
                    //loadedMesh.position.x = position.x;
                    loadedMesh.position.z = position.y;
                    app.octree.update();
                });
                tween.start();
                app.octree.add(loadedMesh);
            });
            layer.model = models;
            app.mergeLayer(layer);
            project.layers[i] = layer;
            //app.scene.add(layer.mergeMesh);
        });

        app.octree.update();
        app.octreeNeedsUpdate = true;
        app.wmsready = true;
        app.frustum = new THREE.Frustum();
    };

    app.addEventListeners = function () {
        window.addEventListener("keydown", app.eventListener.keydown);
        window.addEventListener("resize", app.eventListener.resize);

        //mouseEvent
        window.addEventListener("mousemove", app.eventListener.onMouseMove, false);

        var e = Q3D.$("closebtn");
        if (e) e.addEventListener("click", app.closePopup);
    };

    app.eventListener = {
        keydown: function (e) {
            if (e.ctrlKey || e.altKey) return;
            var keyPressed = e.which;
            if (!e.shiftKey) {
                if (keyPressed == 27) app.closePopup(); // ESC
                else if (keyPressed == 73) app.showInfo();  // I
                else if (keyPressed == 87) app.setWireframeMode(!app._wireframeMode);    // W
            }
            else {
                if (keyPressed == 82) app.controls.reset();   // Shift + R
                else if (keyPressed == 83) app.showPrintDialog();    // Shift + S
            }
        },

        resize: function () {
            if (app._fullWindow) app.setCanvasSize(window.innerWidth, window.innerHeight);
        },

        onMouseMove: function () {
            app.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            app.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        }

    };

    app.setCanvasSize = function (width, height) {
        app.width = width;
        app.height = height;
        app.camera.aspect = width / height;
        app.camera.updateProjectionMatrix();
        app.renderer.setSize(width, height);
    };

    app.buildDefaultLights = function (parent) {
        var deg2rad = Math.PI / 180;

        // ambient light
        //parent.add(new THREE.AmbientLight(0x111111));

        // directional lights
        var opt = Q3D.Options.light.directional;
        var lambda = (90 - opt.azimuth) * deg2rad;
        var phi = opt.altitude * deg2rad;

        var x = Math.cos(phi) * Math.cos(lambda),
            y = Math.cos(phi) * Math.sin(lambda),
            z = Math.sin(phi);

        var light1 = new THREE.DirectionalLight(0xffffff, 0.8);
        light1.position.set(0, 100, 500);
        /*
          light1.castShadow = true;
          light1.shadowCameraVisible = true;
          var d = 20;
          light1.shadowMapWidth = 2048;
          light1.shadowMapHeight = 2048;
          light1.shadowCameraLeft = -d;
          light1.shadowCameraRight = d;
          light1.shadowCameraTop = d;
          light1.shadowCameraBottom = -d;
  
          light1.shadowCameraFar = 1000;
          light1.shadowDarkness = 0.2; */
        parent.add(light1);

        // thin light from the opposite direction
        var light2 = new THREE.DirectionalLight(0xffffff, 0.1);
        light2.position.set(-x, -y, -z);
        
        light2.castShadow = true;
        light2.shadowDarkness = 0.5;
        light2.shadowCameraVisible = true;
        parent.add(light2);
    };

    app.buildDefaultCamera = function () {
        app.camera = new THREE.PerspectiveCamera(45, app.width / app.height, 0.1, 1000);


        var position = { x: 0, y: 0, z: 150};
        var target = { x: 45, y: 15, z:10 };
        var tween = new TWEEN.Tween(position).to(target, 5000);

        tween.easing(TWEEN.Easing.Exponential.InOut);
        tween.onUpdate(function () {
            //loadedMesh.position.x = position.x;
            app.camera.position.set(position.x, position.y, position.z);
            app.camera.lookAt(new THREE.Vector3(0, 0, 0));
       
        });
        tween.start();
       
    };

    app.currentViewUrl = function () {
        var c = app.camera.position, t = app.controls.target, u = app.camera.up;
        var hash = "#cx=" + c.x + "&cy=" + c.y + "&cz=" + c.z;
        if (t.x || t.y || t.z) hash += "&tx=" + t.x + "&ty=" + t.y + "&tz=" + t.z;
        if (u.x || u.y || u.z != 1) hash += "&ux=" + u.x + "&uy=" + u.y + "&uz=" + u.z;
        return window.location.href.split("#")[0] + hash;
    };

    // start rendering loop
    app.start = function () {
        app.running = true;
        if (app.controls) app.controls.enabled = true;
        app.animate();
    };

    app.pause = function () {
        app.running = false;
        if (app.controls) app.controls.enabled = false;
    };

    // animation loop
    app.animate = function () {
        app.stats.begin();
        
        //Set the raycaster vector to originate from the camera with direction onto the mouse position
        app.raycaster.setFromCamera(app.mouse, app.camera);
     
        //If we changed the active octree update
        if (app.octreeNeedsUpdate) {
            app.octree.update();
            app.octreeObjects = app.octree.search(app.raycaster.ray.origin, 100, true, app.vector);
        }
        //If the camera lookat has changed, search the octree
        var vector = new THREE.Vector3(0, 0, -1);
        vector.applyQuaternion(app.camera.quaternion);
        if (app.vector == undefined) {
            app.vector = vector;
        }
        if (app.lastposition == undefined) {
            console.log("updated lastposition to");
            //Take a deepcopy of the last position
            app.lastposition = $.extend(true, {}, app.camera.position);
        }

        if ((app.wmsready && ((vector.x != app.vector.x && vector.y != app.vector.y && vector.z != app.vector.z) || app.lastposition.x != app.camera.position.x)) || app.octreeNeedsUpdate) {
            app.vector = vector; //Re-assign the current camera position
            app.lastposition = $.extend(true, {}, app.camera.position); //Take a new deep copy
            app.octreeObjects = app.octree.search(app.raycaster.ray.origin, 100, true, app.vector);

            if (app.octreeObjects.length > 0) {
                app.removeLayer(0, false);
                
                for (var i = 0; i < app.octreeObjects.length; i++) {
                    app.scene.add(app.octreeObjects[i].object);
                }
            }
        }
        app.octreeNeedsUpdate = false;

        if (app.wmsready) {
            // find intersections
                 if (app.project.layers != undefined && app.project.layers[0].model != undefined) {
                     var intersects = app.raycaster.intersectObjects(app.project.layers[0].model);
                  if (intersects.length > 0) {
                      if (app.INTERSECTED != intersects[0].object) {
        
                          if (app.INTERSECTED) app.INTERSECTED.material.emissive.setHex(app.INTERSECTED.currentHex);
        
                          app.INTERSECTED = intersects[0].object;
                          app.INTERSECTED.currentHex = app.INTERSECTED.material.emissive.getHex();
                          app.INTERSECTED.material.emissive.setHex(0x00ff00);
                  }
                  } else {
                      if (app.INTERSECTED) app.INTERSECTED.material.emissive.setHex(app.INTERSECTED.currentHex);
                      app.INTERSECTED = null;
                  }
                  } 
        }
        TWEEN.update();
        app.render();

        app.stats.end();

        if (app.running) requestAnimationFrame(app.animate);
        if (app.controls) app.controls.update();
    
    };

    app.render = function () {
        app.renderer.render(app.scene, app.camera);

    };


    app.setWireframeMode = function (wireframe) {
        if (wireframe == app._wireframeMode) return;

        app.project.layers.forEach(function (layer) {
            layer.setWireframeMode(wireframe);
        });

        app._wireframeMode = wireframe;
    };

    app.queryableObjects = function () {
        if (app.queryObjNeedsUpdate) {
            app._queryableObjects = [];
            app.project.layers.forEach(function (layer) {
                if (layer.visible && layer.queryableObjects.length) {
                    app._queryableObjects = app._queryableObjects.concat(layer.queryableObjects);
                    // console.log("Added the queryable objects for normal layer");
                }
            });
            //Custom WFS layer addition - Nicolai
            if (app.project.layers != undefined) {
                app.project.layers.forEach(function (layer) {
                    if (layer.model.length) {
                        app._queryableObjects = app._queryableObjects.concat(layer.model);
                        // console.log("Added the queryable Objects for WFS");
                    }
                });
            }
        }
        //Make the plane tiles queryable
        if (app.project.plane != undefined) {
            app.project.plane.forEach(function (plane) {
                app._queryableObjects = app._queryableObjects.concat(plane);
            });
        }
        return app._queryableObjects;
    };

    app.intersectObjects = function (offsetX, offsetY) {
        var x = (offsetX / app.width) * 2 - 1;
        var y = -(offsetY / app.height) * 2 + 1;
        var vector = new THREE.Vector3(x, y, 1);
        vector.unproject(app.camera);
        var ray = new THREE.Raycaster(app.camera.position, vector.sub(app.camera.position).normalize());
        //  console.log(app.queryableObjects());
        return ray.intersectObjects(app.queryableObjects());
    };

    app._offset = function (elm) {
        var top = 0, left = 0;
        do {
            top += elm.offsetTop || 0; left += elm.offsetLeft || 0; elm = elm.offsetParent;
        } while (elm);
        return { top: top, left: left };
    };

    app.help = function () {
        var lines = (Q3D.Controls === undefined) ? [] : Q3D.Controls.keyList;
        if (lines.indexOf("* Keys") == -1) lines.push("* Keys");
        lines = lines.concat([
          "I : Show Information About Page",
          "W : Wireframe Mode",
          "Shift + R : Reset View",
          "Shift + S : Save Image"
        ]);
        var html = '<table>';
        lines.forEach(function (line) {
            if (line.trim() == "") return;

            if (line[0] == "*") {
                html += '<tr><td colspan="2" class="star">' + line.substr(1).trim() + "</td></tr>";
            }
            else if (line.indexOf(":") == -1) {
                html += '<tr><td colspan="2">' + line.trim() + "</td></tr>";
            }
            else {
                var p = line.split(":");
                html += "<tr><td>" + p[0].trim() + "</td><td>" + p[1].trim() + "</td></tr>";
            }
        });
        html += "</table>";
        return html;
    };

    app.popup = {

        modal: false,

        // show box
        // obj: html or element
        show: function (obj, title, modal) {

            if (modal) app.pause();
            else if (this.modal) app.start();   // enable controls

            this.modal = Boolean(modal);

            var content = Q3D.$("popupcontent");
            if (obj === undefined) {
                // show page info
                content.style.display = "none";
                Q3D.$("pageinfo").style.display = "block";
            }
            else {
                Q3D.$("pageinfo").style.display = "none";
                if (obj instanceof HTMLElement) {
                    content.innerHTML = "";
                    content.appendChild(obj);
                }
                else {
                    content.innerHTML = obj;
                }
                content.style.display = "block";
            }
            Q3D.$("popupbar").innerHTML = title || "";
            Q3D.$("popup").style.display = "block";
        },

        hide: function () {
            Q3D.$("popup").style.display = "none";
            if (this.modal) app.start();    // enable controls
        }

    };

    app.showInfo = function () {
        Q3D.$("urlbox").value = app.currentViewUrl();
        Q3D.$("usage").innerHTML = app.help();
        app.popup.show();
    };

    app.showQueryResult = function (point, layerId, featureId) {
        var layer, r = [];
        if (layerId !== undefined) {
            //If layerId is WFS - Nicolai
            if (layerId == 100 || layerId == 110) {
                layer = app.project.layers[0];
                r.push('<table class="layer">');
                r.push("<caption>Layer name</caption>");
                r.push("<tr><td>" + layer.type + "</td></tr>");
                r.push("</table>");

            } else {
                // layer name
                layer = app.project.layers[layerId];
                r.push('<table class="layer">');
                r.push("<caption>Layer name</caption>");
                r.push("<tr><td>" + layer.name + "</td></tr>");
                r.push("</table>");
            }
     
        }

        // clicked coordinates
        var pt = app.project.toMapCoordinates(point.x, point.y, point.z);
        console.log(point.x + " " + point.y);
    
        r.push('<table class="coords">');
        r.push("<caption>Clicked coordinates</caption>");
        r.push("<tr><td>");

        if (typeof proj4 === "undefined") r.push([pt.x.toFixed(2), pt.y.toFixed(2), pt.z.toFixed(2)].join(", "));
        else {
            var lonLat = proj4(app.project.proj).inverse([pt.x, pt.y]);
            r.push(Q3D.Utils.convertToDMS(lonLat[1], lonLat[0]) + ", Elev. " + pt.z.toFixed(2));
      
        }
        app.getList(pt.x.toFixed(2), pt.y.toFixed(2));

        r.push("</td></tr></table>");

        if (layerId !== undefined && featureId !== undefined && layer.a !== undefined) {
            // attributes
            r.push('<table class="attrs">');
            r.push("<caption>Attributes</caption>");
            //   console.log(layerId);
            var prop = [];

            for (var proper in layer.a[0]) {
                prop.push(proper);
            }
                for (var prop in layer.a[featureId]) {
                    if (layer.a[featureId].hasOwnProperty(prop)) {
                        if (String(prop) != "Polygon" && String(prop) != "geometri" && String(prop) != "outerBoundaryIs" && String(prop) != "LinearRing" && String(prop) != "coordinates") {
                      
                            r.push("<tr><td>" + prop + "</td><td>" + layer.a[featureId][prop] + "</td></tr>");
                        }
                    }
                }
        }
        app.popup.show(r.join(""));
    };

    app.showPrintDialog = function () {

        function e(tagName, parent, innerHTML) {
            var elem = document.createElement(tagName);
            if (parent) parent.appendChild(elem);
            if (innerHTML) elem.innerHTML = innerHTML;
            return elem;
        }

        var f = e("form");
        f.className = "print";

        var d1 = e("div", f, "Image Size");
        d1.style.textDecoration = "underline";

        var d2 = e("div", f),
            l1 = e("label", d2, "Width:"),
            width = e("input", d2);
        d2.style.cssFloat = "left";
        l1.htmlFor = width.id = width.name = "printwidth";
        width.type = "text";
        width.value = app.width;
        e("span", d2, "px,")

        var d3 = e("div", f),
            l2 = e("label", d3, "Height:"),
            height = e("input", d3);
        l2.htmlFor = height.id = height.name = "printheight";
        height.type = "text";
        height.value = app.height;
        e("span", d3, "px");

        var d4 = e("div", f),
            ka = e("input", d4);
        ka.type = "checkbox";
        ka.checked = true;
        e("span", d4, "Keep Aspect Ratio");

        var d5 = e("div", f, "Option");
        d5.style.textDecoration = "underline";

        var d6 = e("div", f),
            bg = e("input", d6);
        bg.type = "checkbox";
        bg.checked = true;
        e("span", d6, "Fill Background");

        var d7 = e("div", f),
            ok = e("span", d7, "OK"),
            cancel = e("span", d7, "Cancel");
        d7.className = "buttonbox";

        e("input", f).type = "submit";

        // event handlers
        // width and height boxes
        var aspect = app.width / app.height;

        width.oninput = function () {
            if (ka.checked) height.value = Math.round(width.value / aspect);
        };

        height.oninput = function () {
            if (ka.checked) width.value = Math.round(height.value * aspect);
        };

        ok.onclick = function () {
            app.popup.show("Rendering...");
            window.setTimeout(function () {
                app.saveCanvasImage(width.value, height.value, bg.checked);
            }, 10);
        };

        cancel.onclick = app.closePopup;

        // enter key pressed
        f.onsubmit = function () {
            ok.onclick();
            return false;
        }

        app.popup.show(f, "Save Image", true);   // modal
    };

    app.closePopup = function () {
        app.popup.hide();
        app.queryMarker.visible = false;
       // app.highlightFeature(null, null);
        if (app._canvasImageUrl) {
            URL.revokeObjectURL(app._canvasImageUrl);
            app._canvasImageUrl = null;
        }
    };

    app.highlightFeature = function (layerId, featureId) {
        
        if (app.highlightObject) {
            // remove highlight object from the scene
            app.scene.remove(app.highlightObject);
            app.selectedLayerId = null;
            app.selectedFeatureId = null;
            app.highlightObject = null;
        }
 
        if (Q3D.gui.gui.__folders["Selected Feature"] == undefined) {
            var folder = Q3D.gui.gui.addFolder("Selected Feature");
            folder.open();
        } else {
            var folder = Q3D.gui.gui.__folders["Selected Feature"];
            Q3D.gui.gui.__ul.removeChild(folder.domElement.parentNode);
            delete Q3D.gui.gui.__folders["Selected Feature"];

            if (layerId != null && featureId != null) {
                
                var folder = Q3D.gui.gui.addFolder("Selected Feature");
                folder.open();
            } 
        }

      
        if (layerId === null || featureId === null) return;
        var layer = app.project.layers[layerId];
        if (layer === undefined) return;
        if (["Icon", "JSON model", "COLLADA model"].indexOf(layer.objType) != -1) return;

        
        var model = layer.model[featureId];
      //  if (f === undefined || f.objs.length == 0) return;



       
        
        //Change Opacity
        /* folder.add(Q3D.gui.parameters, 'opacity').name('Show Layer').min(0).max(1).name('Opacity (0-1)').onChange(function (opacityValue) {
             console.log(this.i);
 
             for (var i = 0; i < project.WFSlayers[index].model.length; i++) {
 
                 project.WFSlayers[index].model[i].material.transparent = true;
                 project.WFSlayers[index].model[i].material.opacity = opacityValue;
             }
         });*/
        /*folder.add(Q3D.gui.parameters, 'enabled').name('Show Layer').onChange(function (enabled) {
            if (enabled) {
                app.scene.add(model);
            } else {
                app.scene.remove(model);
            }
        }); */
        folder.addColor(Q3D.gui.parameters, 'color').name('Color selected').onChange(function (color) {
                 var pColor = color.replace('#', '0x');
                 model.material.color.setHex(pColor);             
        });
        folder.addColor(Q3D.gui.parameters, 'color').name('Color layer').onChange(function (color) {

            var pColor = color.replace('#', '0x');
            for (var i = 0; i < layer.model.length; i++) {
                layer.model[i].material.color.setHex(pColor);
                layer.mergeMesh.material.color.setHex(pColor);
            }
          

        });
        
        folder.add(Q3D.gui.parameters, 'height').min(0).max(5).name('Height').onChange(function (height) {

           
          //  model.position.z = height;
                model.scale.set(1, 1, height);

            
        }); 


        var high_mat = app.highlightMaterial;
        var setMaterial = function (obj) {
            obj.material = high_mat;
        };

 
        // create a highlight object (if layer type is Point, slightly bigger than the object)
       // var highlightObject = new THREE.Group();
        //var clone, s = (layer.type == Q3D.LayerType.Point) ? 1.01 : 1;

        //console.log("Trying to make sprite with this label: " + app.address);
        //var sprite = app.makeTextSprite(app.address, 24);

        /*for (var i = 0, l = f.objs.length; i < l; i++) {
            clone = f.objs[i].clone();
            console.log(clone.matrixWorld);
            clone.traverse(setMaterial);
            if (s != 1) clone.scale.set(clone.scale.x * s, clone.scale.y * s, clone.scale.z * s);


            highlightObject.add(clone);
        } */
        var clone = model.clone();
        clone.material = high_mat;
        var s = 1.0;
       
        //Calculates the position of the cloned object in world coordinates
        clone.geometry.computeBoundingBox();
        var boundingBox = clone.geometry.boundingBox;

        var position = new THREE.Vector3();
        position.subVectors(boundingBox.max, boundingBox.min);
        position.multiplyScalar(0.5);
        position.add(boundingBox.min);
        //clone.userData.layerId = null;
        position.applyMatrix4(clone.matrixWorld);
        clone.scale.set(clone.scale.x * s, clone.scale.y * s, clone.scale.z * s);
        var highlightObject = clone;
        //sprite.position.set(position.x, position.y, 1.2);
        // add the highlight object to the scene
        //app.octree.add(highlightObject);
        app.scene.add(highlightObject);
        app.scene.updateMatrixWorld(true);
        //app.scene.add(sprite);
        
        /*
            for (var i = 0; i < app.csvResults.data.length; i++) {
                var temp = 0;
                temp = (app.csvResults.data[i].value - min) / (max - min);
                app.csvResults.data[i].value = temp;
            }


            for (var i = 0; i < layer.f.length; i++) {
                for (var j = 0; j < app.csvResults.data.length; j++) {
                    if (layer.f[i].a[0] == app.csvResults.data[j].FOT) {
                        layer.f[i].objs[0].scale.set(1, 1, app.csvResults.data[j].value * 2);

                        var redness = Math.round(app.csvResults.data[j].value * 255);
                        var greenness = Math.round(255 - (Math.round(app.csvResults.data[j].value * 255)));

                        var material = new THREE.MeshBasicMaterial({ color: "rgb(" + redness + ", " + greenness + ", 0)", opacity: 1 });
                        layer.f[i].objs[0].material = material;
                    }
                }
            }
            app.rancsv = true;
        }
  
  */
        app.selectedLayerId = layerId;
        app.selectedFeatureId = featureId;
        app.highlightObject = highlightObject;

        
    };


    app.getBuildings = function (xmin,ymin,xmax,ymax,row,column,url,name,showBuildings) {
        if (row == 0) {
            row = 1;
        } else if (row < 0) {
            row = row;
        } else {
            row++;
            row++;
        }

        if (column == 0) {
            column = 1;
        } else if (column < 0) {
            column = column;
          
        } else {
            column++;
            column++;
        }

        console.log(row + " " + column)
        //   var xmin = app.project.baseExtent[0];
        //   var ymin = app.project.baseExtent[1];
        //   var xmax = app.project.baseExtent[2];
        //   var ymax = app.project.baseExtent[3];
      
        var bbox = "&Bbox=" + xmin + "," + ymin + "," + xmax + "," + ymax;
        url = url + bbox;
        app.wmsready = false;
        app.removeLayer(0,true);
        
        console.log(url);
        $.ajax({
            url: url,
            dataType: "xml",
        })
       .success(function (response) {
     
           var coordinates = response.getElementsByTagName("coordinates");
           var attributes = response.getElementsByTagName("Bygning");
        
           if (coordinates.length > 0) {
               if (app.project.layers == undefined) {
                   app.project.layers = [];
                   app.project.layers[0] = {};
                   app.project.layers[0].model = [];
                   app.project.layers[0].a = [];
                   app.project.layers[0].modelJSON = [];
                   app.project.layers[0].name = "FOT10";
               } else {
                   var index = app.project.layers.length;
                   app.project.layers[index] = {}
                   app.project.layers[index].model = []
                   app.project.layers[index].a = []
                   app.project.layers[index].modelJSON = []
                   app.project.layers[index].name = "FOT10";
               }
               
               var loader = new THREE.JSONLoader();
               var widthP = app.project.width;
               var heightP = app.project.height;

               var widthM = xmax - xmin;
               var heightM = ymax - ymin;

               var factorX = (widthP / widthM);
               var factorY = (heightP / heightM);

               for (var i = 0; i < coordinates.length; i++) {
                   //For every collection of coordinates, we have to convert them to threejs points
                   var gmlPoints = new XMLSerializer().serializeToString(coordinates[i].childNodes[0]);
                   var cords = gmlPoints.split(" ");

                   var points = [];
                   var xs = [];
                   var ys = [];
                   for (var j = 0; j < cords.length; j++) {
                       var xyz = cords[j].split(",");
                       var x = xyz[0];
                       var y = xyz[1];
                       var z = xyz[2];
                  
                       var ptx = (widthP * (column) / 2) - (((xmax - x) * factorX));
                       var pty = (heightP * (row) / 2) - (((ymax - y) * factorY));
            
                       var point = new THREE.Vector3(ptx, pty, z);
                       points.push(point);
                       xs.push(x);
                       ys.push(y);
                   }
                   if (attributes[i] != undefined) {
                       var gmlAttributes = attributes[i].getElementsByTagName("*");
                       app.project.layers[index].a[i] = {};
                       for (var k = 0; k < gmlAttributes.length; k++) {
                           var key = String(gmlAttributes[k].nodeName);
                           var key = key.replace(/kms:|gml:/gi, "");
                           var value = gmlAttributes[k].innerHTML;
                           app.project.layers[index].a[i][key] = value;
                       }
                   }
               
                   var shape = new THREE.Shape(points);
                   var extrudeSettings = {
                       amount: 1,
                       steps: 2,
                       bevelEnabled: false,
                   };

                   var color = 0xaaaaaa;
                   var material = new THREE.MeshPhongMaterial({
                       color: color,
                   });


                   var geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                   var mesh = new THREE.Mesh(geometry, material);
                   if (z > 0) {
                       mesh.scale.set(1, 1, (z * app.project.zScale) / 2);
                   } else {
                       mesh.scale.set(1, 1, app.project.zScale * 12);
                   }
               
                   //Compute the center coordinate of the box that bounds the object:

                   var xminMap = Math.min.apply(null, xs);
                   var xmaxMap = Math.max.apply(null, xs);
                   var yminMap = Math.min.apply(null, ys);
                   var ymaxMap = Math.max.apply(null, ys);

                   //The coordinate will be
                   var xCorMap = xminMap + ((xmaxMap - xminMap) / 2);
                   var yCorMap = yminMap + ((ymaxMap - yminMap) / 2);
                   mesh.mapcoords = [xCorMap, yCorMap];
           
                   mesh.userData.layerId = app.project.layers.length-1;
                   mesh.userData.featureId = i;
                   var meshString = JSON.stringify(mesh);
                   app.project.layers[index].modelJSON[i] = meshString;
                   app.project.layers[index].model[i] = mesh;

                   if (showBuildings == true) {
                       app.octree.add(mesh);
                       var opacity = 0.3;
                   } else {
                       var opacity = 1;
                   }
                   
               }
               app.project.layers[index].url = url;
               app.project.layers[index].name = name;
               app.project.layers[index].type = "GML";
               
               app.mergeLayer(app.project.layers[index],opacity);
            
               Q3D.gui.addCustomLayers(project.layers[index]);
           }
      
       
     
       })
     .fail(function (jqXHR, textStatus, errorThrown) {
         console.log("Failed jquery");
     });

    }

    /*
    Merges a layer into one geometry for performance gain
    Adds the mergedGeometry as a representation mesh of that layer
    Adds the mergedGeometry to the octree
    */
    app.mergeLayer = function (layer,opacity) {
        var mergeGeometry = new THREE.Geometry();

        for (var i = 0; i <layer.model.length; i++) {
            layer.model[i].updateMatrix();

            var geometry = layer.model[i].geometry;
            var matrix = layer.model[i].matrix;

            mergeGeometry.merge(geometry, matrix, i);
            //app.project.WFSlayers[0].model.geometry
        }
        console.log(mergeGeometry);

    
    mergeGeometry.dynamic = true;
    
    var material = new THREE.MeshPhongMaterial({opacity: opacity, transparent: true, color: 0xffffff });
    var mesh = new THREE.Mesh(mergeGeometry,material);
    layer.mergeMesh = mesh;

    var position = { x: 0, y: -2 };
    var target = { x: 0, y: 0 };
    var tween = new TWEEN.Tween(position).to(target, 3000);

    tween.onUpdate(function () {
        //loadedMesh.position.x = position.x;
        mesh.position.z = position.y;
        app.octree.update();
    });
    tween.onComplete(function () {
        
        app.wmsready = true;
        
    });
    app.octree.add(mesh);
    app.octreeNeedsUpdate = true;
    tween.start();
}

  app.generateTerrain = function (url, height, width) {

        var img = new Image();
        var canvas = document.createElement('canvas');
        canvas.width = width - 1;
        canvas.height = height - 1;
        var context = canvas.getContext('2d');
        var data = new Float32Array(0);



        img.onload = function () {
  
      var width = 2;
      var height = 2;
     // var url = "http://kortforsyningen.kms.dk/service?servicename=orto_sommer_2010&request=GetMap&service=WMS&version=1.1.1&LOGIN=Bydata&PASSWORD=Qby2016%21&layers=orto_sommer_2010&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
      var url = "http://kortforsyningen.kms.dk/service?servicename=topo_geo&client=QGIS&request=GetMap&service=WMS&version=1.1.1&LOGIN=Bydata&PASSWORD=Qby2016%21&layers=bygning&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
            // var url = "http://kortforsyningen.kms.dk/service?servicename=adm_500_2008_r&request=GetMap&service=WMS&version=1.1.1&LOGIN=Bydata&PASSWORD=Qby2016%21&layers=KOM500_2008&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
     // var url = "http://kortforsyningen.kms.dk/service?servicename=topo4cm_1953_1976&request=GetMap&service=WMS&version=1.1.1&LOGIN=Bydata&PASSWORD=Qby2016!&layers=dtk_4cm_1953_1976&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";

            img.height = height;
            img.width = width;
            for (var i = 0; i < size; i++) {
                data[i] = 0
            }

            var imgd = context.getImageData(0, 0, width, height);
            var pix = imgd.data;

            var j = 0;
            for (var i = 0; i < pix.length; i += 4) {
                var all = pix[i] + pix[i + 1] + pix[i + 2];
                data[j++] = all / 24;
            }

            var geometry = new THREE.PlaneGeometry(app.project.width, app.project.height, width - 1, height - 1);
            var texture = THREE.ImageUtils.loadTexture(url);
            var material = new THREE.MeshLambertMaterial({ map: texture });

            var plane = new THREE.Mesh(geometry, material);
            console.log("vertices: " + plane.geometry.vertices.length);
            console.log("Data Length: " + data.length)

            //set height of vertices
            for (var i = 0; i < plane.geometry.vertices.length; i++) {
                plane.geometry.vertices[i].z = data[i];
            }
            geometry.verticesNeedUpdate = true;
            app.project.layers[0].setVisible(false);
            app.project.plane = [];
            app.project.plane[0] = plane;
            console.log(app.project.plane[0]);
            console.log("Adding plane!");
            app.scene.add(app.project.plane[0]);
        }
        img.src = url;
        img.crossOrigin = "Anonymous";

    }

  app.calculatebbox = function (num) {
  
        THREE.ImageUtils.crossOrigin = ""; //Allows us to avoid CORS problems for textures
        //Gets the extent of the project plane
        var xmin = parseFloat(app.project.baseExtent[0]);
        var ymin = parseFloat(app.project.baseExtent[1]);
        var xmax = parseFloat(app.project.baseExtent[2]);
        var ymax = parseFloat(app.project.baseExtent[3]);

        //The length of a tile in spatial reference notation
        var tilex = parseFloat((xmax - xmin) / num);
        var tiley = parseFloat((ymax - ymin) / num);

        //Tile pixel dimensions (Higher is more detailed)
        var width = 512;
        var height = 512;
    
        //The service URL for the layer we are using for map (Here orto photos from kortforsyningen)
        var url = "http://kortforsyningen.kms.dk/service?servicename=orto_foraar&request=GetMap&service=WMS&version=1.1.1&LOGIN=student134859&PASSWORD=3dgis&layers=orto_foraar&width=" + (width) + "&height=" + (height) + "&format=image%2Fpng&srs=EPSG%3A25832";
       // var url = "http://kortforsyningen.kms.dk/service?servicename=topo_skaermkort&client=QGIS&request=GetMap&service=WMS&version=1.1.1&LOGIN=Bydata&PASSWORD=Qby2016%21&layers=dtk_skaermkort_07&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
        var materials = []; //Array to hold our tiled images
        var loader = new THREE.TextureLoader();
        loader.crossOrigin = true;
        //
        // BLOCK
        //
        //For each tile, generate that plane, and place them next to each other.
            
        // var urlTerrain = "http://kortforsyningen.kms.dk/service?servicename=dhm&request=GetMap&service=WMS&version=1.1.1&LOGIN=student134859&PASSWORD=3dgis&layers=dtm_1_6m&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
        // urlTerrain = urlTerrain + "&bbox=" + xmin + "," + ymin + "," + xmax + "," + ymax;
        //app.generateTerrain(urlTerrain, height, width);

        //Create the proper materials, we dont care to wait until they are loaded
        for (var column = num - 1; column >= 0; column--) {
            for (var row = 0; row < num; row++) {
                THREE.ImageUtils.crossOrigin = '';
                var texture = THREE.ImageUtils.loadTexture(url + "&bbox=" + (xmin + (row * tilex)+2) + "," + (ymin + (column * tiley)-2) + "," + (xmin + ((row + 1) * tilex)) + "," + (ymin + ((column + 1) * tiley)));
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.x = num;
                texture.repeat.y = num;

                var material = new THREE.MeshPhongMaterial({ map: texture });
                material.url = url + "&bbox=" + (xmin + (row * tilex)) + "," + (ymin + (column * tiley)) + "," + (xmin + ((row + 1) * tilex)) + "," + (ymin + ((column + 1) * tiley));
                material.bbox = "&bbox=" + (xmin + (row * tilex)) + "," + (ymin + (column * tiley)) + "," + (xmin + ((row + 1) * tilex)) + "," + (ymin + ((column + 1) * tiley));
                console.log(material.url + material.bbox);
                materials.push(material);
            }
        }
      
        var geometry = new THREE.PlaneGeometry(app.project.width, app.project.height,num,num);
        geometry.materials = materials;

        var l = geometry.faces.length / 2; // divided by 2 because each tile consists two triangles, which is two faces.

        //i % materials.length assigns each face with the next material in the list
        //Works because each face is one texture

        //Figure out how faces are assigned, is it per row or per column?
                for (var i = 0; i < l; i++) {
                    //Make sure we texture in pairs (Dont want triangle tiles)
                        var j = i*2
                        geometry.faces[j].materialIndex = i % materials.length;
                        geometry.faces[j + 1].materialIndex = i % materials.length;
                    }

      /*
      Material here is an experiment for tiled tiles so to speak.
      */
        //var material = new THREE.MeshFaceMaterial(materials);
        var plane = new THREE.Mesh(geometry, material);
        plane.position.z = 0;
        if (app.project.plane != undefined) {
            app.scene.remove(app.project.plane[0]);
        }

        plane.receiveShadow = true;
        app.project.plane = [];
        //app.octree.add(plane);
        app.project.plane.push(plane);
        app.octree.update();
        app.scene.add(app.project.plane[0]);
        app.updateResolution(plane, num, width, height);
        app.extendMap(2);
    }

  app.extendMap = function (dim) {
      var num = 1;
     
      var xmin = parseFloat(app.project.baseExtent[0]);
      var ymin = parseFloat(app.project.baseExtent[1]);
      var xmax = parseFloat(app.project.baseExtent[2]);
      var ymax = parseFloat(app.project.baseExtent[3]);

      //The length of a tile in spatial reference notation
      var tilex = parseFloat((xmax - xmin) / num);
      var tiley = parseFloat((ymax - ymin) / num);

      //Tile pixel dimensions (Higher is more detailed)
      var width = 256;
      var height = 256;
      var url = app.project.map.url + "&width=" +width+"&height="+height;
      var materials = [];
      //The service URL for the layer we are using for map (Here orto photos from kortforsyningen)
     // var url = "http://kortforsyningen.kms.dk/service?servicename=orto_foraar&request=GetMap&service=WMS&version=1.1.1&LOGIN=student134859&PASSWORD=3dgis&layers=orto_foraar&width=" + (width) + "&height=" + (height) + "&format=image%2Fpng&srs=EPSG%3A25832";
      var buildingUrl = "http://services.kortforsyningen.dk/service?servicename=topo_geo_gml2&VERSION=1.0.0&SERVICE=WFS&REQUEST=GetFeature&TYPENAME=kms:Bygning&login=student134859&password=3dgis&maxfeatures=5000";
      for (var column = -dim; column <= dim; column++) {
          for (var row = -dim; row <= dim; row++) {
              var tempPlane = app.project.plane[0].clone();
              //We dont want to draw the center tile
              if (column == 0 && row == 0) {
                 
                  continue;
              }


              THREE.ImageUtils.crossOrigin = '';
              var texture = THREE.ImageUtils.loadTexture(url + "&bbox=" + (xmin + (column * tilex)) + "," + (ymin + (row * tiley)) + "," + (xmin + ((column + 1) * tilex)) + "," + (ymin + ((row + 1) * tiley)));
              var material = new THREE.MeshPhongMaterial({ map: texture })
              material.url = url + "&bbox=" + (xmin + (column * tilex)) + "," + (ymin + (row * tiley)) + "," + (xmin + ((column + 1) * tilex)) + "," + (ymin + ((row + 1) * tiley));
              material.bbox = "&bbox=" + (xmin + (column * tilex)) + "," + (ymin + (row * tiley)) + "," + (xmin + ((column + 1) * tilex)) + "," + (ymin + ((row + 1) * tiley));


              tempPlane.material = material;
              tempPlane.position.x = app.project.width * column;
              tempPlane.position.y = app.project.height * row;

              app.scene.add(tempPlane);
              tempPlane.column = column;
              tempPlane.row = row;

              //Information to build buildings on the tile:
              tempPlane.userData.url = buildingUrl;
              tempPlane.userData.xmin = (xmin + (column * tilex));
              tempPlane.userData.ymin = (ymin + (row * tiley));
              tempPlane.userData.xmax = (xmin + ((column + 1) * tilex));
              tempPlane.userData.ymax = (ymin + ((row + 1) * tiley));
              tempPlane.userData.row = row;
              tempPlane.userData.column = column;


              app.project.plane.push(tempPlane);
              //var buildings = "http://services.kortforsyningen.dk/service?servicename=topo_geo_gml2&VERSION=1.0.0&SERVICE=WFS&REQUEST=GetFeature&TYPENAME=kms:Bygning&login=student134859&password=3dgis&maxfeatures=5000";
              //app.getBuildings((xmin + (column * tilex)), (ymin + (row * tiley)), (xmin + ((column + 1) * tilex)), (ymin + ((row + 1) * tiley)), row, column, (buildings + "&bbox=" + (xmin + (column * tilex)) + "," + (ymin + (row * tiley)) + "," + (xmin + ((column + 1) * tilex)) + "," + (ymin + ((row + 1) * tiley))),"Fot10");
             // app.updateResolution(tempPlane, num, width, height);
          }

      }
  }
  app.updateResolution = function (plane,num, width, height) {
        var loader = new THREE.TextureLoader();
        loader.crossOrigin = true;
        var materials = [];
        var loaded = 0;

        for (var i = 0; i < 1; i++) {
            //var temp = plane.material.materials[i];
            var temp = plane.material;
            var url = temp.url;
      
            var tempurl = "width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832&";
            url = url.replace(/width=.*&/, tempurl);

              THREE.ImageUtils.crossOrigin = '';
              var texture = THREE.ImageUtils.loadTexture(url);
              texture.wrapS = THREE.RepeatWrapping;
              texture.wrapT = THREE.RepeatWrapping;
              texture.repeat.x = num;
              texture.repeat.y = num;

              var material = new THREE.MeshPhongMaterial({ map: texture });
              material.url = url;
              material.bbox = temp.bbox;
              materials.push(material);

              loader.load(url, function (texture) {
                 
                  /*
                  Experiemtn if tile has tiled materials (for terrain example)
                   loaded += 1;
                  if (loaded == plane.material.materials.length) {    //We loaded all the images
                  // the default
                  var faceMaterial = new THREE.MeshFaceMaterial(materials);
                  plane.material = faceMaterial;

                       if (height <= 1024) {
                        app.updateResolution(plane,num, width * 2, height * 2)

                  }
                    //           app.wmsTerrain(num,width,height);
              }
            }); */
                  plane.material = material;
                  if (height <= 1024) {
                      app.updateResolution(plane,num, width * 2, height * 2)

                  }
              });
    }
  }
  
  app.removeLayer = function (id, removeoctree) {
      //  app.wmsready = false;
          app.scene.children.forEach(function (child) {
              if (child.userData.layerId == id) {
                  app.scene.remove(child);
                  child = null;
              }
          });
          if (removeoctree) {
              for (var i = 0; i < app.project.layers.length; i++) {
                  console.log(app.project.layers[i].model[0].userData.layerId);
                  if (app.project.layers[i].model[0].userData.layerId == id) {
                      for (var j = 0; j < app.project.layers[i].model.length; j++) {
                          app.octree.remove(app.project.layers[i].model[j]);

                          console.log("called!!!");
                      }
                      app.octree.remove(app.project.layers[i].mergeMesh);
                  }
              }
          }


          app.octreeNeedsUpdate = true;
      
  };
  app.getbounds = function (url) {
     
     var xmin = app.project.baseExtent[0];
     var ymin = app.project.baseExtent[1];
     var xmax = app.project.baseExtent[2];
     var ymax = app.project.baseExtent[3];

     var bbox = "&Bbox=" + xmin + "," + ymin + "," + xmax + "," + ymax

     app.wmsready = false;

     $.ajax({
         url: url + bbox,
         dataType: "json",
     })
    .success(function (response) {
        console.log(response);
        console.log("Found: " + response.features.length + " Features");

        if (response.features.length > 0) {
            
            app.project.layers = [];

            app.project.layers.push(response);
            app.project.layers[0].model = [];
            app.project.layers[0].a = [];

            var points = [];
            for (var i = 0; i < response.features.length; i++) {
                //Determine geometry type
                if (response.features[i].geometry.type == "Point" || response.features[i].geometry.type == "MultiPoint") {
                    //If point, create a point object. 
                    //Point object is defined as a yellow sphere for simplicity

                    var geometry = new THREE.CylinderGeometry(5, 5, 20, 32);
                    var material = new THREE.MeshLambertMaterial({
                        color: 0xffaaaa
                    });
                    var sphere = new THREE.Mesh(geometry, material);
                    sphere.rotation.x = Math.PI / 2;
                    var x = response.features[i].geometry.coordinates[0];
                    var y = response.features[i].geometry.coordinates[1];
                    var z = 1;

                    //Okay we have the width and height, plus the bounding box
                    //Figure out how to calculate mapcoordinates to project coordinates.

                    //In each direction
                    var widthP = app.project.width;
                    var heightP = app.project.height;

                    var widthM = xmax - xmin;
                    var heightM = ymax - ymin;

                    var factorX = widthP / widthM;
                    var factorY = heightP / heightM;


                    var ptx = widthP / 2 - ((xmax - x) * factorX);
                    var pty = heightP / 2 - ((ymax - y) * factorY);

                    // var pt = app.project.toMapCoordinates(x, y, z);



                    sphere.position.set(ptx, pty, 0.5);
                   
                    sphere.scale.set(0.05, 0.25, 0.05);
                    //LayerID 100 until we figure out proper indentation - Nicolai
                    sphere.userData.layerId = app.project.layers.length-1;
                    sphere.userData.featureId = i;
                    // app.scene.add(sphere);
                    //Okay so instead of adding a sphere to the scene, we can add the sphere to our WFSLayer geometry

                    //Todo create proper indexing somehow.
                    app.project.layers[0].model[i] = sphere;
                    app.project.layers[0].a[i] = app.project.layers[0].features[i].properties;
                    app.octree.add(project.layers[0].model[i]);
        

                }
                else if (response.features[i].geometry.type == "Polygon" || response.features[i].geometry.type == "MultiPolygon") {

                    //TODO - Nicolai
                    //console.log(response);
                    //get points from feature
                    //console.log("There are this many coordinates in feature " + i + " " + response.features[i].geometry.coordinates[0][0].length);

                    if (response.features[i].geometry.type == "Polygon") {
                        var length = response.features[i].geometry.coordinates[0].length;
                        var polygon = "Polygon";
                    } else {
                        var length = response.features[i].geometry.coordinates[0][0].length;
                        var polygon = "MultiPolygon";
                    }

                    for (var j = 0; j < length; j++) {
                        //  console.log(response.features[i].geometry.coordinates[0][0][j]);
                        if (polygon == "MultiPolygon") {
                            var x = response.features[i].geometry.coordinates[0][0][j][0];
                            var y = response.features[i].geometry.coordinates[0][0][j][1];
                        } else {
                            var x = response.features[i].geometry.coordinates[0][j][0];
                            var y = response.features[i].geometry.coordinates[0][j][1];
                        }

                        
                        //Okay we have the width and height, plus the bounding box
                        //Figure out how to calculate mapcoordinates to project coordinates.

                        //In each direction
                        var widthP = app.project.width;
                        var heightP = app.project.height;

                        var widthM = xmax - xmin;
                        var heightM = ymax - ymin;

                        var factorX = widthP / widthM;
                        var factorY = heightP / heightM;

                        var ptx = widthP / 2 - ((xmax - x) * factorX);
                        var pty = heightP / 2 - ((ymax - y) * factorY);

                        var point = new THREE.Vector2(ptx, pty);
                        points.push(point);
                    }

                    var shape = new THREE.Shape(points);
                    var extrudeSettings = {
                        amount: 1.2,
                        steps: 1,
                        material: 0,
                        extrudeMaterial: 1,
                        bevelEnabled: false
                    };

                    //use points to build shape



                    //build a geometry (ExtrudeGeometry) from the shape and extrude settings
                    var geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                    geometry.dynamic = true;

                    var hex = 0xff0000;
                    var hex2 = 0xaa0011;
                    var hex3 = 0x990033;
                    var color = 0xffffff;

                       var colorlist = [hex, hex2, hex3];


                  //  color = colorlist[Math.floor(Math.random() * colorlist.length)];

                    var material = new THREE.MeshPhongMaterial({
                        color: color
                    });

                    var mesh = new THREE.Mesh(geometry, material);
                    mesh.scale.set(1, 1, 5 * Math.random());
                    mesh.userData.layerId = app.project.layers.length-1;
                    mesh.userData.featureId = i;
                    // app.scene.add(sphere);
                    //Okay so instead of adding a sphere to the scene, we can add the sphere to our WFSLayer geometry

                    //Todo create proper indexing somehow.
                    app.project.layers[0].model[i] = mesh;
                    app.project.layers[0].a[i] = app.project.layers[0].features[i].properties;
                    app.octree.add(project.layers[0].model[i]);
                   // app.scene.add(project.layers[0].model[i]);
                    //  app.render();
                    points = [];
                    // var polygon = new THREE.Mesh(geometry, material);

                    // var x = response.features[i].geometry.coordinates[0];
                    // var y = response.features[i].geometry.coordinates[1];
                    // var z = 1;

                    //Okay we have the width and height, plus the bounding box
                    //Figure out how to calculate mapcoordinates to project coordinates.
     
                }
            }
            
        }
       

        app.wmsready = true;
        Q3D.gui.addCustomLayers(project.layers[0]);
    })
    .fail(function (jqXHR, textStatus, errorThrown) {
        console.log("Failed jquery");
    });
    
      /*
     Test to build the features 
       */

      //WFS contains:
      //Crs - properties - code (EPSG)
      //features - objects - geometry - coordinates - 0 1
      //                              - type (point, polygon etc)

 
    

  };
  app.wmsTerrain = function (num, width, height) {
        var url = "http://kortforsyningen.kms.dk/service?servicename=dhm&request=GetMap&service=WMS&version=1.1.1&LOGIN=student134859&PASSWORD=3dgis&layers=dtm_1_6m&width=" + width + "&height=" + height + "&format=image%2Fpng&srs=EPSG%3A25832";
      var loader = new THREE.TextureLoader();
      loader.crossOrigin = true;

      //for (var i = 0; i < app.project.plane[0].material.materials.length; i++) {

          var temp = app.project.plane[0].material.materials[0];
          url = url + temp.bbox;
          console.log(url);
          //Get the height data from the terrain image
          var img = new Image();
          var canvas = document.createElement('canvas');
          canvas.width = width - 1;
          canvas.height = height - 1;
          var context = canvas.getContext('2d');
          var data = new Float32Array(0);
          img.onload = function () {

              var size = 0;
              context.drawImage(img, 0, 0);
              size = width * height;
              data = new Float32Array(size);
              
             img.height = height;
             img.width = width;
              for (var i = 0; i < size; i++) {
                  data[i] = 0
              }

          var imgd = context.getImageData(0, 0, width, height);
          var pix = imgd.data;
        
          console.log("Pix length: " + pix.length);
          console.log(pix);
         var j = 0;
          for (var i = 0; i < pix.length; i += 4) {
              var all = pix[i] + pix[i + 1] + pix[i + 2];
                data[j++] = all / 12;
          }

         // plane
         // var geometry = app.project.plane[0].geometry;
          console.log(this.width);
          console.log(this.height);
          var geometry = new THREE.PlaneGeometry(app.project.width, app.project.height, width - 1, height-1);

          var texture = THREE.ImageUtils.loadTexture(url);
          var material = new THREE.MeshLambertMaterial({ map: texture });

         //aterial.wireframe = true;
          var plane = new THREE.Mesh(geometry, material);
          console.log("vertices: " + plane.geometry.vertices.length);
          console.log("Data Length: " + data.length)
              //set height of vertices
          
          for (var i = 0; i < plane.geometry.vertices.length; i++) {
              plane.geometry.vertices[i].z = data[i];
          }
          geometry.verticesNeedUpdate = true;
          plane.setWireframeMode = true;
          app.project.plane[1] = plane;
          plane.position.set(1, 1, 1.5);

            return plane;
            // app.scene.add(plane);
          }
          img.src = url;
          img.crossOrigin = "Anonymous";
         
          
    //  }



  };
    
  app.makeTextSprite = function (message, fontsize) {
      var ctx, texture, sprite, spriteMaterial,
          canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
      ctx.font = fontsize + "px Arial";

      // setting canvas width/height before ctx draw, else canvas is empty
      canvas.width = ctx.measureText(message).width;
      canvas.height = fontsize * 2; // fontsize * 1.5

      // after setting the canvas width/height we have to re-set font to apply!?! looks like ctx reset
      ctx.font = fontsize + "px Arial";
      ctx.fillStyle = "rgba(255,0,0,1)";
      ctx.fillText(message, 0, fontsize);

      texture = new THREE.Texture(canvas);
      texture.minFilter = THREE.LinearFilter; // NearestFilter;
      texture.needsUpdate = true;

      spriteMaterial = new THREE.SpriteMaterial({ map: texture });
      sprite = new THREE.Sprite(spriteMaterial);
      return sprite;
  };

  app.getList = function (xCor, yCor) {
      var d = new Date().getTime(); // for now

      var host = "http://dawa.aws.dk";
      var parametre = {};
      var srid = "";
      $.ajax({
          url: "http://dawa.aws.dk/adgangsadresser/reverse?x=" + xCor + "&y=" + yCor + "&srid=25832",
          dataType: "json",
      })
      .success(function (response) {
          if (response.length === 0) {
              console.log("Bad stuff");
          }
          else {
              app.address = response.vejstykke.adresseringsnavn + " " + response.husnr;
             
              var clone = app.project.layers[0].model[0].clone();
              clone.geometry.computeBoundingBox();
              var boundingBox = clone.geometry.boundingBox;
              var position = new THREE.Vector3();
              position.subVectors(boundingBox.max, boundingBox.min);
              position.multiplyScalar(0.5);
              position.add(boundingBox.min);
              position.applyMatrix4(clone.matrixWorld);

              console.log(position);

              /*
              Makeshift method to iterate over all buildings in the scene
              */
              // for (var i = 0; i <= layer.f.length - 10; i++) {
              //   console.log(layer.f[i].a[0]);
              // }
              //app.selectedLayerId = layerId;
              //app.selectedFeatureId = featureId;
           

              var n = new Date().getTime();
              var total = n - d;
              console.log("Time elapsed for DAWA Call: " + total);

          }
      })
      .fail(function (jqXHR, textStatus, errorThrown) {
          console.log("Failed jquery");
      });

  };


  app.getAddress = function (index) {
      var d = new Date().getTime(); // for now

      var host = "http://dawa.aws.dk";
      var parametre = {};
      var srid = "";
      
      var xCor = app.project.layers[0].model[index].mapcoords[0];
      var yCor = app.project.layers[0].model[index].mapcoords[1];
      $.ajax({
          url: "http://dawa.aws.dk/adgangsadresser/reverse?x=" + xCor + "&y=" + yCor + "&srid=25832",
          dataType: "json",
      })
      .success(function (response) {
          if (response.length === 0) {
              console.log("Bad stuff");
          }
          else {
              var address = response.vejstykke.adresseringsnavn + " " + response.husnr + ", " + response.postnummer.nr;
              app.project.layers[0].a[index]["Adresse"] = address;

              if (index == 1) { console.log(response) };

              if (response.adgangspunkt.nøjagtighed == "A") {
                  app.project.layers[0].model[index].material.color.setHex(0x00ff00);
              } else if (response.adgangspunkt.nøjagtighed == "B") {
                  app.project.layers[0].model[index].material.color.setHex(0xffff00);
              } else if (response.adgangspunkt.nøjagtighed == "C") {
                  app.project.layers[0].model[index].material.color.setHex(0xff0000);
              }
              



              var n = new Date().getTime();
              var total = n - d;
             
          }
      })
      .fail(function (jqXHR, textStatus, errorThrown) {
          console.log("Failed jquery");
      });

  };
  app.searchBuilding = function (value) {
      console.log("Search buildign is called");
      var layertype = 0; //For polygons
      var featuretype = 0; //for FOT_ID


      for (var i = 0; i < app.project.layers[layertype].a.length; i++) {
          //console.log(app.project.layers[layertype].a[1]);
          if (app.project.layers[layertype].a[i]["FOTID"] == value) {
             // app.highlightFeature(layertype, i);
              console.log("Highlighted building with FOT_ID: " + value);

             app.project.layers[layertype].model[i].geometry.computeBoundingBox();
           
             var boundingBox = app.project.layers[layertype].model[i].geometry.boundingBox;

             var position = new THREE.Vector3();
             position.subVectors(boundingBox.max, boundingBox.min);
             position.multiplyScalar(0.5);
             position.add(boundingBox.min);

             app.scene.updateMatrixWorld();
             position.applyMatrix4(app.project.layers[layertype].model[i].matrixWorld);

             app.camera.position.set(position.x, position.y, 10);
             app.controls.target = position;
          }
      }
  
  };
  // Called from *Controls.js when canvas is clicked
  app.canvasClicked = function (e) {
    var canvasOffset = app._offset(app.renderer.domElement);
    var objs = app.intersectObjects(e.clientX - canvasOffset.left, e.clientY - canvasOffset.top);
    for (var i = 0, l = objs.length; i < l; i++) {
        var obj = objs[i];
      if (!obj.object.visible) continue;

      // query marker
      //app.queryMarker.position.set(obj.point.x, obj.point.y, obj.point.z);
      //app.queryMarker.visible = true;
      //app.queryMarker.updateMatrixWorld();

      // get layerId and featureId of clicked object
      var object = obj.object, layerId, featureId;

      if (object.userData.url != undefined) {
          var d = object.userData;
          console.log(d);
          app.updateResolution(object, 1, 256, 256);
          app.getBuildings(d.xmin, d.ymin, d.xmax, d.ymax, d.row, d.column, d.url, "Tile", false);
      }

      

      while (object) {
        layerId = object.userData.layerId,
        featureId = object.userData.featureId;
        if (layerId !== undefined) break;
        object = object.parent;
      }

      if (app.highlightObject == null) {
      app.showQueryResult(obj.point, layerId, featureId);
        // highlight clicked object
      } else {
          if (featureId == app.highlightObject.userData.featureId) {
              layerId = undefined;
              featureId = undefined;
              app.closePopup();
          } else {
              app.showQueryResult(obj.point, layerId, featureId);
          }
      }
     
      app.highlightFeature((layerId === undefined) ? null : layerId,
                         (featureId === undefined) ? null : featureId);



      if (Q3D.Options.debugMode && object instanceof THREE.Mesh) {
        var face = obj.face,
            geom = object.geometry;
        if (face) {
          if (geom instanceof THREE.Geometry) {
            var v = object.geometry.vertices;
            console.log(v[face.a], v[face.b], v[face.c]);
          }
          else {
            console.log("Qgis2threejs: [DEBUG] THREE.BufferGeometry");
          }
        }
      }

      return;
    }
    app.closePopup();
  };

  app.saveCanvasImage = function (width, height, fill_background) {
    if (fill_background === undefined) fill_background = true;

    // set canvas size
    var old_size;
    if (width && height) {
      old_size = [app.width, app.height];
      app.setCanvasSize(width, height);
    }

    // functions
    var saveBlob = function (blob) {
      var filename = "image.png";

      // ie
      if (window.navigator.msSaveBlob !== undefined) {
        window.navigator.msSaveBlob(blob, filename);
        app.popup.hide();
      }
      else {
        // create object url
        if (app._canvasImageUrl) URL.revokeObjectURL(app._canvasImageUrl);
        app._canvasImageUrl = URL.createObjectURL(blob);

        // display a link to save the image
        var e = document.createElement("a");
        e.className = "download-link";
        e.href = app._canvasImageUrl;
        e.download = filename;
        e.innerHTML = "Save";
        app.popup.show("Click to save the image to a file." + e.outerHTML, "Image is ready");
      }
    };

    var saveCanvasImage = function (canvas) {
      if (canvas.toBlob !== undefined) {
        canvas.toBlob(saveBlob);
      }
      else {    // !HTMLCanvasElement.prototype.toBlob
        // https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement.toBlob
        var binStr = atob(canvas.toDataURL("image/png").split(',')[1]),
            len = binStr.length,
            arr = new Uint8Array(len);

        for (var i = 0; i < len; i++) {
          arr[i] = binStr.charCodeAt(i);
        }

                saveBlob(new Blob([arr], { type: "image/png" }));
      }
    };


    var restoreCanvasSize = function () {
      // restore canvas size
      if (old_size) app.setCanvasSize(old_size[0], old_size[1]);
      app.render();
    };

    // background option
    if (!fill_background) app.renderer.setClearColor(0, 0);

    // render
    app.renderer.preserveDrawingBuffer = true;
    app.renderer.render(app.scene, app.camera);

    // restore clear color
    var bgcolor = Q3D.Options.bgcolor;
    app.renderer.setClearColor(bgcolor || 0, (bgcolor === null) ? 0 : 1);

    
    if ((fill_background && bgcolor === null)) {
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      var ctx = canvas.getContext("2d");
      if (fill_background && bgcolor === null) {
        // render "sky-like" background
        var grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, "#98c8f6");
        grad.addColorStop(0.4, "#cbebff");
        grad.addColorStop(1, "#f0f9ff");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      var image = new Image();
      image.onload = function () {
        // draw webgl canvas image
        ctx.drawImage(image, 0, 0, width, height);


        // save canvas image
        saveCanvasImage(canvas);
        restoreCanvasSize();
      };
      image.src = app.renderer.domElement.toDataURL("image/png");
    }
    else {
      // save webgl canvas image
      saveCanvasImage(app.renderer.domElement);
      restoreCanvasSize();
    }
  };
})();


