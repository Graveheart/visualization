// Global values
var state = {
  data: {
    meters: undefined,
    metersStats: undefined
  },
  menu: {
    season: "summer",
    day: "monday",
    time: 12
  },
  storyIndex: 0,
  timeScale: undefined,
  timeouts: []
};

// Configuration used for the menu buttons
var MENU_CONFIG = {
  "season" : [
    "summer",
    "winter"
  ],
  "day" : [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday"
  ]
}

// Initializer
d3.select(window).on('load', init); // Calls init on window load

function init() {
  // Add menu buttons
  createMenu(function() {
    var group = d3.select(this).attr("data-key");
    var val = d3.select(this).attr("data-value");
    state.menu[group] = val.toLowerCase();
    updateState(true);
  });

  // Add time slider
  createTimeSlider(function(hour) {
    state.menu.time = Math.round(hour);
    updateState(true);
  });

  // Set story clickers and update story
  d3.select("#story-next").on("click", nextStory);
  d3.select("#story-prev").on("click", prevStory);
  updateStory();

  // Prepare map of Copenhagen (coordinates are lon/lat)
  state.map = L.map('map', {
    center: [55.685, 12.59],
    zoom: 13,
    minZoom: 13
  });

  // Create map layer
  L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; '
      + '<a href="http://openstreetmap.org">OpenStreetMap</a>'
      + ' Contributors'
  }).addTo(state.map);

  // D3 path for parking meters, projected onto Leaflet map
  state.geoPath = d3.geoPath()
    .projection(d3.geoTransform({
      point: function(x, y) {
        var point = state.map.latLngToLayerPoint(new L.LatLng(y, x));
        this.stream.point(point.x, point.y);
      }
    })
  );

  // Load data
  d3.queue()
    .defer(d3.json, "./data/zones.geojson")
    .defer(d3.json, "./data/meters.geojson")
    .defer(d3.json, "./data/metersStats.json")
    .await(ready);

  // Called after data is loaded
  function ready(error, zones, meters, metersStats) {
    if (error) throw error;

    // Set global data variables
    state.data.meters = meters;
    state.data.metersStats = metersStats;

    // Render zones
    var geoJson = L.geoJson(zones, {
      style: function(d) {
        return styleForZone(d.properties.zone_navn)
      },
      onEachFeature: function (feature, layer) {
        layer.bindPopup();
      }
    }).addTo(state.map);

    // Zones popover showing price
    geoJson.on('click', function(el){
      var layer = el.layer;
      var feature = layer.feature;
      var price = priceForZone(feature.properties);
      if (price) {
        price += " DKK/hour";
      } else {
        price = "free";
      }
      layer._popup.setContent("<span class='zone-heading'>"
        + feature.properties.beskrivelse
        + "</span><br/><span class='zone-price'>Price: "
        + price
        + "</span>");
    });

    // Add parking meters
    var gMeters = d3.select("#map svg")
      .append("g")
      .attr("class", "meters")
      .selectAll("path")
      .data(meters.features)
      .enter()
      .append("path")
      .attr("stroke", "black")
      .attr("stroke-width", "1")
      .attr("fill", "red")
      .attr("class", "meter");

    // Update the meters' paths on zoom
    state.map.on("zoom", function() {
      gMeters.attr("d", state.geoPath);
    });

    // Create color legend
    state.colorScale = d3.scaleLinear()
      .domain([0, meterStatsMaxStay()])
      .range(["rgb(220, 200, 200)", "rgb(220, 0, 0)"]);

    var colorLegend = d3.legendColor()
      .shapeWidth(30)
      .orient('horizontal')
      .cells(10)
      .labelFormat(function(x) { return d3.format("d")(x) + "h"; })
      .scale(state.colorScale);

    d3.select("#color-legend")
      .append("g")
      .attr("class", "legend")
      .attr("transform", "translate(20,0)")
      .call(colorLegend);

    // Create size legend
    state.sizeScale = d3.scaleLinear()
      .domain([0, meterStatsMaxCount()])
      .range([0.2, 20]);

    var sizeLegend = d3.legendSize()
      .scale(state.sizeScale)
      .shape('circle')
      .shapePadding(15)
      .labelOffset(20)
      .labelFormat(function(x) { return d3.format("d")(x) + ""; })
      .orient('horizontal');

    d3.select("#size-legend")
      .append("g")
      .attr("class", "legend")
      .attr("transform", "translate(100, 30)")
      .call(sizeLegend);

    // Updates buttons selected, meter formatting, etc.
    updateState(false);
  }
}

// Creates menu buttons
function createMenu(clickCallback) {
  for (var key in MENU_CONFIG) {
    d3.select("#menu-" + key)
      .selectAll('button')
      .data(MENU_CONFIG[key]).enter()
      .append('button')
      .attr("class", "btn btn-default")
      .attr("data-key", key)
      .attr("data-value", function (d) { return d; })
      .html(function (d) { return capitalizeFirstLetter(d); })
      .on('click', clickCallback);
  }
}

// Create the time slider
// Adapted from: https://bl.ocks.org/mbostock/6452972
function createTimeSlider(endDragCallback) {
  // Prepare
  var svg = d3.select("#time-slider svg");
  var margin = {right: 50, left: 50};
  var width = +svg.node().getBoundingClientRect().width - margin.left - margin.right;
  var height = +svg.node().getBoundingClientRect().height;

  // Create scale for 24 hours
  var xScale = d3.scaleLinear()
    .domain([0, 23])
    .range([0, width])
    .clamp(true);

  // Create g for the slider
  var slider = svg.append("g")
    .attr("class", "slider")
    .attr("transform", "translate(" + margin.left + "," + height / 2 + ")");

  // Add slider line
  slider.append("line")
    .attr("class", "track")
    .attr("x1", xScale.range()[0])
    .attr("x2", xScale.range()[1])
    .call(d3.drag()
        .on("start.interrupt", function() { slider.interrupt(); })
        .on("start drag", function() { var val = xScale.invert(d3.event.x);
            handle.attr("cx", xScale(val));
            endDragCallback(val); }));

  // Create drag handle
  var handle = slider.insert("circle", ".track-overlay")
      .attr("class", "handle")
      .attr("r", 15)
      .call(d3.drag()
          .on("drag", function() {
            var val = xScale.invert(d3.event.x);
            handle.attr("cx", xScale(val));
            endDragCallback(val);
          })
          // .on("end", function() {
          //   var val = xScale.invert(d3.event.x);
          //   endDragCallback(val);
          // })
      );

  // Save scale
  state.timeScale = xScale;
}

// Goes to the next story
function nextStory() {
  d3.event.preventDefault();
  state.storyIndex = state.storyIndex + 1;
  updateStory();
}

// Goes to the previous story
function prevStory(e) {
  d3.event.preventDefault();
  state.storyIndex = state.storyIndex - 1;
  updateStory();
}

// Updates the story view
function updateStory() {
  // Enable/disable buttons
  d3.select("#story-next").classed("disabled", false);
  d3.select("#story-prev").classed("disabled", false);
  if (state.storyIndex == 0) {
    d3.select("#story-prev").classed("disabled", true);
  } else if (state.storyIndex == STORIES.length - 1) {
    d3.select("#story-next").classed("disabled", true);
  }

  // Update text
  $("#story-text").fadeOut(function() {
    STORIES[state.storyIndex]["callback"]();
    $(this).html(STORIES[state.storyIndex]["text"]).fadeIn();
  });
}

// Updates states of buttons, meters
function updateState(animated) {
  var dayOfWeek = {
    "monday" : 0,
    "tuesday" : 1,
    "wednesday" : 2,
    "thursday" : 3,
    "friday" : 4,
    "saturday" : 5,
    "sunday" : 6
  };

  // Update day buttons
  for (day in dayOfWeek) {
    var but = d3.select('button[data-key="day"][data-value="' + day + '"]');
    if (state.menu.day == day) {
      but.classed("active", true);
    } else {
      but.classed("active", false);
    }
  }

  // Update season buttons
  var seasons = ["summer", "winter"];
  for (idx in seasons) {
    var but = d3.select('button[data-key="season"][data-value="' + seasons[idx] + '"]');
    if (state.menu.season == seasons[idx]) {
      but.classed("active", true);
    } else {
      but.classed("active", false);
    }
  }

  // Update time slider
  d3.select('#time-slider circle')
    .attr("cx", state.timeScale(state.menu.time));

  // Update time label
  d3.select('#time-label p').text(state.menu.time + ":00 to " + state.menu.time + ":59");

  // Create key for getting media stats (non-trivial algorithm used to make downloaded file smaller)
  var statsKey = state.menu.season.substring(0, 1)
    + "-" + dayOfWeek[state.menu.day]
    + "-" + (state.menu.time * 60 * 60)
    + "-";

  // Update point radius function (to reflect size at time given by state)
  state.geoPath.pointRadius(function(d) {
    var stats = state.data.metersStats[statsKey + d.properties.parkomat_id];
    var count = getCountFromMeterStats(stats);

    d.properties.count = count;
    if(stats) {
      d.properties.stay = stats.s;
    } else {
      d.properties.stay = 0;
    }

    return getAdjustedSize(1.5 * Math.sqrt(state.sizeScale(count))) + 1;
  });

  // Create tooltip to be applied to all meters
  var tip = d3.tip()
    .attr('class', 'd3-tip')
    .html(setTooltipHtml)
    .direction('n')
    .offset([-3, 0]);

  // Apply tooltip to meters group
  if(d3.select(".meters").node()){
    d3.select(".meters").call(tip);
  }

  // Set meter color and size
  // Calling attr("d", ...) updates the sizing (since have to use pointRadius)
  var meters = d3.selectAll("path.meter")
    .on("mouseover", tip.show)
    .on("mouseout", tip.hide);

  if (animated) {
    meters = meters.transition();
  }

  meters.attr("fill", function(d) {
      var stats = state.data.metersStats[statsKey + d.properties.parkomat_id];
      var stay = getStayFromMeterStats(stats);
      return state.colorScale(stay);
    })
    .attr("d", state.geoPath);
}

// Extracts count from meter stats
function getCountFromMeterStats(stats) {
  if (stats) {
    return stats["c"];
  } else {
    return 0;
  }
}

// Extracts stay time from meter stats
function getStayFromMeterStats(stats) {
  if (stats) {
    return stats["s"] / stats["c"] / (60 * 60);
  } else {
    return 0;
  }
}

// Maximum number of active transactions for any meter
function meterStatsMaxCount() {
  var res = 0;
  for (key in state.data.metersStats) {
    var count = getCountFromMeterStats(state.data.metersStats[key]);
    res = Math.max(res, count);
  }
  return res;
}

// Longest stay for any meter
function meterStatsMaxStay() {
  var res = 0;
  for (key in state.data.metersStats) {
    var hours = getStayFromMeterStats(state.data.metersStats[key]);
    res = Math.max(res, hours);
  }
  return res;
}

// Maps zone names to Leaflet styles
function styleForZone(zoneType) {
  var fill;
  switch(zoneType) {
    case "Blå":
      fill = "#007DBF";
      break;
    case "Gul":
      fill = "yellow";
      break;
    case "Rød":
      fill = "red";
      break;
    default:
      fill = "green";
  }
  return {fillColor: fill, color: 'gray', fillOpacity: 0.4, className: 'zone'};
}

// Price for a zone
function priceForZone(properties) {
  var time = state.menu.time;
  var day = state.menu.day;
  var property;
  if (time < 8) {
    property = "ptakst_nat";
    if (day == "monday") {
      property = null;
    }
  } else if (time < 18) {
    property = "ptakst_dag";
  } else if (time < 23) {
    property = "ptakst_aften";
    if (day == "saturday") {
      property = null;
    }
  } else {
    property = "ptakst_nat";
  }
  if (day == "sunday") {
    property = null;
  }
  return properties[property];
}

// Used to adjust meter sizes according to the zoom level
function getAdjustedSize(size) {
  var zoom = state.map.getZoom();
  var maxZoom = state.map.getMaxZoom();
  if (zoom == 12) {
    zoom = 12.5;
  }
  var adjustment = Math.sqrt(maxZoom - zoom);
  return size * (2 * (zoom - 11)) - adjustment;
}

// Tooltip for when hovering over parking meter
function setTooltipHtml(d) {
  var properties = d.properties;

  if (!properties.husnr) {
    properties.husnr = "";
  }

  var averageStay = 0;
  if (properties.count) {
    averageStay = Math.round(properties.stay / properties.count);
  }

  var html = capitalizeFirstLetter(properties.vejnavn) + " " + properties.husnr
    + "<br/>" + "Parked cars: " + properties.count
    + "<br/>" + "Average stay: " + formatSeconds(averageStay) ;
  return html;
}

function formatSeconds(secs) {
  var minutes = Math.floor(secs / 60);
  var hours = Math.floor(minutes / 60);
  minutes = minutes % 60;
  return hours + "h " + minutes + "m";
}

function capitalizeFirstLetter(string) {
  if (string && string.length > 0) {
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
  } else {
    return string;
  }
}

// Stories (constant)
STORIES = [
  {
    "text" : "On this page, you can explore usage of parking meters in the city of Copenhagen. The data presented is based on excerpts consisting of regular summer and winter weeks in the year 2014. Click the arrow to the right to explore the data.",
    "callback" : function() {
      state.timeouts.forEach(function(tid) { clearTimeout(tid) });
      state.menu.season = "summer";
      state.menu.day = "wednesday";
      state.menu.time = 12;
      state.map.setView([55.685, 12.59], 13);
      updateState(true);
    }
  },
  {
    "text" : "Let us take a look at a regular Wednesday. We see that the number of cars rises during the day, peaking around lunch and dinner. During the night, and in the evening, there are fewer cars, but their tickets run for a much longer time.",
    "callback" : function() {
      state.timeouts.forEach(function(tid) { clearTimeout(tid) });
      state.menu.season = "summer";
      state.menu.day = "wednesday";
      state.menu.time = 0;
      state.map.setView([55.685, 12.59], 13);
      updateState(true);
      for (var i = state.menu.time + 1; i <= 23; i++) {
        state.timeouts.push(setTimeout(function(x) {
          state.menu.time = x;
          updateState(true);
        }, i * 600, i));
      }
    }
  },
  {
    "text" : "In Copenhagen, parking is free on Sundays. You can still buy parking tickets, which will last into the ensuing Monday. That is why you see so many long duration parking tickets expire during the early Monday hours.",
    "callback" : function() {
      state.timeouts.forEach(function(tid) { clearTimeout(tid) });
      state.menu.season = "summer";
      state.menu.day = "monday";
      state.menu.time = 0;
      state.map.setView([55.685, 12.59], 13);
      updateState(true);
      for (var i = state.menu.time + 1; i <= 10; i++) {
        state.timeouts.push(setTimeout(function(x) {
          state.menu.time = x;
          updateState(true);
        }, i * 750, i));
      }
    }
  },
  {
    "text" : "Slotsholmen contains mainly high-level government offices. Many short-term transactions during the day show how people arive perhaps for just a single meeting. Few transactions in the evening show that there are not many people call it home.",
    "callback" : function() {
      state.timeouts.forEach(function(tid) { clearTimeout(tid) });
      state.menu.season = "winter";
      state.menu.day = "wednesday";
      state.menu.time = 4;
      state.map.setView([55.674951, 12.580966], 17);
      updateState(true);
      for (var i = state.menu.time + 1; i <= 23; i++) {
        state.timeouts.push(setTimeout(function(x) {
          state.menu.time = x;
          updateState(true);
        }, i * 600, i));
      }
    }
  },
  {
    "text" : "Tivoli Gardens and the surrounding areas bustle with events in the evening. While people don't visit the area much at the beginning of the week, activity explodes on Thursdays, Fridays and Saturdays",
    "callback" : function() {
      state.timeouts.forEach(function(tid) { clearTimeout(tid) });
      state.menu.season = "summer";
      state.menu.day = "monday";
      state.menu.time = 20;
      state.map.setView([55.672513, 12.570419], 17);
      updateState(true);
      state.timeouts.push(setTimeout(function() { state.menu.day = "tuesday"; updateState(true); }, 2500));
      state.timeouts.push(setTimeout(function() { state.menu.day = "wednesday"; updateState(true); }, 2 * 2500));
      state.timeouts.push(setTimeout(function() { state.menu.day = "thursday"; updateState(true); }, 3 * 2500));
      state.timeouts.push(setTimeout(function() { state.menu.day = "friday"; updateState(true); }, 4 * 2500));
      state.timeouts.push(setTimeout(function() { state.menu.day = "saturday"; updateState(true); }, 5 * 2500));
    }
  },
  {
    "text" : "Fælledparken is the home of Denmark's largest arena. Comparing this summer Tuesday with the surrounding days, something tells us that it housed either a soccer match or a concert.",
    "callback" : function() {
      state.timeouts.forEach(function(tid) { clearTimeout(tid) });
      state.menu.season = "summer";
      state.menu.day = "monday";
      state.menu.time = 20;
      state.map.setView([55.702759, 12.570033], 15);
      updateState(true);
      state.timeouts.push(setTimeout(function() { state.menu.day = "tuesday"; updateState(true); }, 3000));
      state.timeouts.push(setTimeout(function() { state.menu.day = "wednesday"; updateState(true); }, 2 * 3000));
    }
  },
  {
    "text" : "Now it's your turn to explore! What interesting discoveries can you find about parking in Copenhagen?<br/>",
    "callback" : function() {
      state.timeouts.forEach(function(tid) { clearTimeout(tid) });
      state.menu.season = "summer";
      state.menu.day = "wednesday";
      state.menu.time = 12;
      state.map.setView([55.685, 12.59], 13);
      updateState(true);
    }
  },
];
