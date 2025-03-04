'use strict'

const SVG_NS = 'http://www.w3.org/2000/svg'

function svgnew(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag)
  svgattr(el, attrs)
  return el
}

function svgattr(el, attrs) {
  if (attrs != null) {
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        el.setAttributeNS(null, k, attrs[k])
      }
    }
  }
}

function svgattach(parent, child) {
  return parent.appendChild(child)
}

function svgadd(el, tag, attrs) {
  return svgattach(el, svgnew(tag, attrs))
}

function newArray(n, fn) {
  const arr = new Array(n)
  for (let i = 0; i < n; i++) {
    arr[i] = fn(i)
  }
  return arr
}

function arrayEq(a, b) {
  if (a === b) {
    return true
  }
  if (a == null || b == null) {
    return false
  }
  if (a.length != b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

function render(data) {
  const PADDING = 10
  const BOX_HEIGHT = 30
  const BOX_SPACE = 15
  const EPSILON = 20
  const LINE_BLEED = 5
  const BOX_GAP = 20
  const BOX_TEXT_PADDING = 10
  const HISTORY_RECT_RADIUS = 4

  const annotations = data['Annotations']
  const coreHistory = data['Partitions']
  // for simplicity, make annotations look like more history
  const allData = [...coreHistory, { History: annotations }]

  let maxClient = -1
  allData.forEach((partition) => {
    partition['History'].forEach((el) => {
      maxClient = Math.max(maxClient, el['ClientId'])
    })
  })
  // "real" clients, not including tags
  const realClients = maxClient + 1
  // we treat each unique annotation tag as another "client"
  const tags = new Set()
  annotations.forEach((annot) => {
    const tag = annot['Tag']
    if (tag.length !== 0) {
      tags.add(tag)
    }
  })
  // add synthetic client numbers
  const tag2ClientId = {}
  const sortedTags = Array.from(tags).sort()
  sortedTags.forEach((tag) => {
    maxClient = maxClient + 1
    tag2ClientId[tag] = maxClient
  })
  annotations.forEach((annot) => {
    const tag = annot['Tag']
    if (tag.length !== 0) {
      annot['ClientId'] = tag2ClientId[tag]
    }
  })
  // total number of clients now includes these synthetic clients
  const nClient = maxClient + 1

  // Prepare some useful data to be used later:
  // - Add a GID to each event
  // - Create a mapping from GIDs back to events
  // - Create a set of all timestamps
  // - Create a set of all start timestamps
  const allTimestamps = new Set()
  const startTimestamps = new Set()
  const endTimestamps = new Set()
  let gid = 0
  const byGid = {}
  allData.forEach((partition) => {
    partition['History'].forEach((el) => {
      allTimestamps.add(el['Start'])
      startTimestamps.add(el['Start'])
      endTimestamps.add(el['End'])
      allTimestamps.add(el['End'])
      // give elements GIDs
      el['Gid'] = gid
      byGid[gid] = el
      gid++
    })
  })
  let sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b)

  // If one event has the same end time as another's start time, that means that
  // they are concurrent, and we need to display them with overlap. We do this
  // by tweaking the events that share the end time, updating the time to
  // end+epsilon, so we have overlap.
  //
  // We do not render a good visualization in the situation where a single
  // client has two events where one has an end time that matches the other's
  // start time.  There isn't an easy way to handle this, because these two
  // operations are concurrent (see the comment in model.go for more details for
  // why it must be this way), and we can't display them with overlap on the
  // same row cleanly.
  let minDelta = Infinity
  for (let i = 0; i < sortedTimestamps.length - 1; i++) {
    const delta = sortedTimestamps[i + 1] - sortedTimestamps[i]
    if (delta < minDelta) {
      minDelta = delta
    }
  }
  const epsilon = minDelta / 3
  // safe to adjust a timestamp by += epsilon without it overlapping with
  // another adjusted timestamp
  allData.forEach((partition, index) => {
    if (index === allData.length - 1) {
      return // last partition is the annotations
    }
    partition['History'].forEach((el) => {
      let end = el['End']
      el['OriginalEnd'] = end // for display purposes
      if (startTimestamps.has(end)) {
        el['End'] = end + epsilon
        allTimestamps.add(el['End'])
      }
    })
  })

  // Handle display of (1) annotations where one has the same end time as
  // another's start time, and (2) point-in-time annotations, on the same row.
  //
  // Unlike operations, where we interpret the start and end times as a closed
  // interval (and where they have to be displayed with overlap, to be able to
  // render linearizations and partial linearizations correctly), annotations
  // are for display purposes only and we can interpret annotations with
  // different start/end times as open intervals, and render two annotations
  // with times (a, b) and (b, c) without overlap. We can also handle the
  // situation where we have a point-in-time annotation with times (b, b).
  //
  // This code currently does not handle the case where we have two
  // point-in-time annotations with the same tag at the same timestamp.
  //
  // We keep the annotation adjustment epsilon even smaller (dividing by 2), so
  // adjusting an event's end time forward by epsilon doesn't overlap with an
  // annotation's start time that's adjusted forwards (the adjustment of
  // annotations goes in the opposite direction as that for events).
  allData[allData.length - 1]['History'].forEach((el) => {
    if (el['End'] === el['Start']) {
      // point-in-time annotation: we adjust these to have a non-zero-duration;
      // we only need to edit the end timestamp, and we can leave the start
      // as-is
      el['End'] += epsilon / 4
      allTimestamps.add(el['End'])
    } else {
      // annotation touching another event or annotation
      if (startTimestamps.has(el['End'])) {
        el['End'] -= epsilon / 2
        allTimestamps.add(el['End'])
      }
      if (endTimestamps.has(el['Start'])) {
        el['Start'] += epsilon / 2
        allTimestamps.add(el['Start'])
      }
    }
  })

  // Update sortedTimestamps, because we created some new timestamps.
  sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b)

  // Compute layout.
  //
  // We warp time to make it easier to see what's going on. We can think
  // of there being a monotonically increasing mapping from timestamps to
  // x-positions. This mapping should satisfy some criteria to make the
  // visualization interpretable:
  //
  // - distinguishability: there should be some minimum distance between
  // unequal timestamps
  // - visible text: history boxes should be wide enough to fit the text
  // they contain
  // - enough space for LPs: history boxes should be wide enough to fit
  // all linearization points that go through them, while maintaining
  // readability of linearizations (where each LP in a sequence is spaced
  // some minimum distance away from the previous one)
  //
  // Originally, I thought about this as a linear program:
  //
  // - variables for every unique timestamp, x_i = warp(timestamp_i)
  // - objective: minimize sum x_i
  // - constraint: non-negative
  // - constraint: ordering + distinguishability, timestamp_i < timestamp_j -> x_i + EPS < x_j
  // - constraint: visible text, size_text_j < x_{timestamp_j_end} - x_{timestamp_j_start}
  // - constraint: linearization lines have points that fit within box, ...
  //
  // This used to actually be implemented using an LP solver (without the
  // linearization point part, though that should be doable too), but
  // then I realized it's possible to solve optimally using a greedy
  // left-to-right scan in linear time.
  //
  // So that is what we do here. We optimally solve the above, and while
  // doing so, also compute some useful information (e.g. x-positions of
  // linearization points) that is useful later.
  const xPos = {}
  // Compute some information about history elements, sorted by end time;
  // the most important information here is box width.
  const byEnd = allData
    .flatMap((partition) =>
      partition['History'].map((el) => {
        // compute width of the text inside the history element by actually
        // drawing it (in a hidden div)
        const scratch = document.getElementById('calc')
        scratch.innerHTML = ''
        const svg = svgadd(scratch, 'svg')
        const text = svgadd(svg, 'text', {
          'text-anchor': 'middle',
          class: 'history-text',
        })
        text.textContent = el['Description']
        const bbox = text.getBBox()
        const width = bbox.width + 2 * BOX_TEXT_PADDING
        return {
          start: el['Start'],
          end: el['End'],
          width: width,
          gid: el['Gid'],
        }
      })
    )
    .sort((a, b) => a.end - b.end)
  // Some preprocessing for linearization points and illegal next
  // linearizations. We need to figure out where exactly LPs end up
  // as we go, so we can make sure event boxes are wide enough.
  const eventToLinearizations = newArray(gid, () => []) // event -> [{index, position}]
  const eventIllegalLast = newArray(gid, () => []) // event -> [index]
  const allLinearizations = []
  let lgid = 0
  coreHistory.forEach((partition) => {
    partition['PartialLinearizations'].forEach((lin) => {
      const globalized = [] // linearization with global indexes instead of partition-local ones
      const included = new Set() // for figuring out illegal next LPs
      lin.forEach((id, position) => {
        included.add(id['Index'])
        const gid = partition['History'][id['Index']]['Gid']
        globalized.push(gid)
        eventToLinearizations[gid].push({ index: lgid, position: position })
      })
      allLinearizations.push(globalized)
      let minEnd = Infinity
      partition['History'].forEach((el, index) => {
        if (!included.has(index)) {
          minEnd = Math.min(minEnd, el['End'])
        }
      })
      partition['History'].forEach((el, index) => {
        if (!included.has(index) && el['Start'] < minEnd) {
          eventIllegalLast[el['Gid']].push(lgid)
        }
      })
      lgid++
    })
  })
  const linearizationPositions = newArray(lgid, () => []) // [[xpos]]
  // Okay, now we're ready to do the left-to-right scan.
  // Solve timestamp -> xPos.
  let eventIndex = 0
  xPos[sortedTimestamps[0]] = 0 // positions start at 0
  for (let i = 1; i < sortedTimestamps.length; i++) {
    // left-to-right scan, finding minimum time we can use
    const ts = sortedTimestamps[i]
    // ensure some gap from last timestamp
    let pos = xPos[sortedTimestamps[i - 1]] + BOX_GAP
    // ensure that text fits in boxes
    while (eventIndex < byEnd.length && byEnd[eventIndex].end <= ts) {
      // push our position as far as necessary to accommodate text in box
      const event = byEnd[eventIndex]
      const textEndPos = xPos[event.start] + event.width
      pos = Math.max(pos, textEndPos)
      // Ensure that LPs fit in box.
      //
      // When placing the end of an event, for all partial linearizations
      // that include that event, for the prefix that comes before that event,
      // all their start points must have been placed already, so we can figure
      // out the minimum width that the box needs to be to accommodate the LP.
      eventToLinearizations[event.gid]
        .concat(
          eventIllegalLast[event.gid].map((index) => {
            return {
              index: index,
              position: allLinearizations[index].length - 1,
            }
          })
        )
        .forEach((li) => {
          const { index, position } = li
          for (let i = linearizationPositions[index].length; i <= position; i++) {
            // determine past points
            let prev = null
            if (linearizationPositions[index].length != 0) {
              prev = linearizationPositions[index][i - 1]
            }
            const nextGid = allLinearizations[index][i]
            let nextPos
            if (prev === null) {
              nextPos = xPos[byGid[nextGid]['Start']]
            } else {
              nextPos = Math.max(xPos[byGid[nextGid]['Start']], prev + EPSILON)
            }
            linearizationPositions[index].push(nextPos)
          }
          // this next line only really makes sense for the ones in
          // eventToLinearizations, not the ones from eventIllegalLast,
          // but it's safe to do it for all points, so we don't bother to
          // distinguish.
          pos = Math.max(pos, linearizationPositions[index][position])
        })
      // ensure that illegal next LPs fit in box too
      eventIllegalLast[event.gid].forEach((li) => {
        const lin = linearizationPositions[li]
        const prev = lin[lin.length - 1]
        pos = Math.max(pos, prev + EPSILON)
      })

      eventIndex++
    }
    xPos[ts] = pos
  }

  // get maximum tag width
  let maxTagWidth = 0
  for (let i = 0; i < nClient; i++) {
    const tag = i < realClients ? i.toString() : sortedTags[i - realClients]
    const scratch = document.getElementById('calc')
    scratch.innerHTML = ''
    const svg = svgadd(scratch, 'svg')
    const text = svgadd(svg, 'text', {
      'text-anchor': 'end',
    })
    text.textContent = tag
    const bbox = text.getBBox()
    const width = bbox.width + 2 * BOX_TEXT_PADDING
    if (width > maxTagWidth) {
      maxTagWidth = width
    }
  }

  const t0x = PADDING + maxTagWidth // X-pos of line at t=0

  // Solved, now draw UI.

  let selected = false
  let selectedIndex = [-1, -1]

  const height = 2 * PADDING + BOX_HEIGHT * nClient + BOX_SPACE * (nClient - 1)
  const width = 2 * PADDING + maxTagWidth + xPos[sortedTimestamps[sortedTimestamps.length - 1]]
  const svg = svgadd(document.getElementById('canvas'), 'svg', {
    width: width,
    height: height,
  })

  // draw background, etc.
  const bg = svgadd(svg, 'g')
  const bgRect = svgadd(bg, 'rect', {
    height: height,
    width: width,
    x: 0,
    y: 0,
    class: 'bg',
  })
  bgRect.onclick = handleBgClick
  for (let i = 0; i < nClient; i++) {
    const text = svgadd(bg, 'text', {
      x: PADDING + maxTagWidth - BOX_TEXT_PADDING,
      y: PADDING + BOX_HEIGHT / 2 + i * (BOX_HEIGHT + BOX_SPACE),
      'text-anchor': 'end',
    })
    text.textContent = i < realClients ? i : sortedTags[i - realClients]
  }
  // vertical line at t=0
  svgadd(bg, 'line', {
    x1: t0x,
    y1: PADDING,
    x2: t0x,
    y2: height - PADDING,
    class: 'divider',
  })
  // horizontal line dividing clients from annotation tags, but only if there are tags
  if (tags.size > 0) {
    const annotationLineY = PADDING + realClients * (BOX_HEIGHT + BOX_SPACE) - BOX_SPACE / 2
    svgadd(bg, 'line', {
      x1: PADDING,
      y1: annotationLineY,
      x2: t0x,
      y2: annotationLineY,
      class: 'divider',
    })
  }

  // draw history
  const historyLayers = []
  const historyRects = []
  const targetRects = svgnew('g')
  allData.forEach((partition, partitionIndex) => {
    const l = svgadd(svg, 'g')
    historyLayers.push(l)
    const rects = []
    partition['History'].forEach((el, elIndex) => {
      const g = svgadd(l, 'g')
      const rx = xPos[el['Start']]
      const width = xPos[el['End']] - rx
      const x = rx + t0x
      const y = PADDING + el['ClientId'] * (BOX_HEIGHT + BOX_SPACE)
      const rectClass = el['Annotation'] ? 'client-annotation-rect' : 'history-rect'
      rects.push(
        svgadd(g, 'rect', {
          height: BOX_HEIGHT,
          width: width,
          x: x,
          y: y,
          rx: HISTORY_RECT_RADIUS,
          ry: HISTORY_RECT_RADIUS,
          class: rectClass,
          style:
            el['Annotation'] && el['BackgroundColor'].length !== 0
              ? `fill: ${el['BackgroundColor']};`
              : '',
        })
      )
      const text = svgadd(g, 'text', {
        x: x + width / 2,
        y: y + BOX_HEIGHT / 2,
        'text-anchor': 'middle',
        class: 'history-text',
        style: el['Annotation'] && el['TextColor'].length !== 0 ? `fill: ${el['TextColor']};` : '',
      })
      text.textContent = el['Description']
      // we don't add mouseTarget to g, but to targetRects, because we
      // want to layer this on top of everything at the end; otherwise, the
      // LPs and lines will be over the target, which will create holes
      // where hover etc. won't work
      const mouseTarget = svgadd(targetRects, 'rect', {
        height: BOX_HEIGHT,
        width: width,
        x: x,
        y: y,
        class: 'target-rect',
        'data-partition': partitionIndex,
        'data-index': elIndex,
      })
      mouseTarget.onmouseover = handleMouseOver
      mouseTarget.onmousemove = handleMouseMove
      mouseTarget.onmouseout = handleMouseOut
      mouseTarget.onclick = handleClick
    })
    historyRects.push(rects)
  })

  // draw partial linearizations
  const illegalLast = coreHistory.map((partition) => {
    return partition['PartialLinearizations'].map(() => new Set())
  })
  const largestIllegal = coreHistory.map(() => {
    return {}
  })
  const largestIllegalLength = coreHistory.map(() => {
    return {}
  })
  const partialLayers = []
  const errorPoints = []
  coreHistory.forEach((partition, partitionIndex) => {
    const l = []
    partialLayers.push(l)
    partition['PartialLinearizations'].forEach((lin, linIndex) => {
      const g = svgadd(svg, 'g')
      l.push(g)
      let prevX = null
      let prevY = null
      let prevEl = null
      const included = new Set()
      lin.forEach((id) => {
        const el = partition['History'][id['Index']]
        const hereX = t0x + xPos[el['Start']]
        const x = prevX !== null ? Math.max(hereX, prevX + EPSILON) : hereX
        const y = PADDING + el['ClientId'] * (BOX_HEIGHT + BOX_SPACE) - LINE_BLEED
        // line from previous
        if (prevEl !== null) {
          svgadd(g, 'line', {
            x1: prevX,
            x2: x,
            y1: prevEl['ClientId'] >= el['ClientId'] ? prevY : prevY + BOX_HEIGHT + 2 * LINE_BLEED,
            y2: prevEl['ClientId'] <= el['ClientId'] ? y : y + BOX_HEIGHT + 2 * LINE_BLEED,
            class: 'linearization linearization-line',
          })
        }
        // current line
        svgadd(g, 'line', {
          x1: x,
          x2: x,
          y1: y,
          y2: y + BOX_HEIGHT + 2 * LINE_BLEED,
          class: 'linearization linearization-point',
        })
        prevX = x
        prevY = y
        prevEl = el
        included.add(id['Index'])
      })
      // show possible but illegal next linearizations
      // a history element is a possible next try
      // if no other history element must be linearized earlier
      // i.e. forall others, this.start < other.end
      let minEnd = Infinity
      partition['History'].forEach((el, index) => {
        if (!included.has(index)) {
          minEnd = Math.min(minEnd, el['End'])
        }
      })
      partition['History'].forEach((el, index) => {
        if (!included.has(index) && el['Start'] < minEnd) {
          const hereX = t0x + xPos[el['Start']]
          const x = prevX !== null ? Math.max(hereX, prevX + EPSILON) : hereX
          const y = PADDING + el['ClientId'] * (BOX_HEIGHT + BOX_SPACE) - LINE_BLEED
          // line from previous
          svgadd(g, 'line', {
            x1: prevX,
            x2: x,
            y1: prevEl['ClientId'] >= el['ClientId'] ? prevY : prevY + BOX_HEIGHT + 2 * LINE_BLEED,
            y2: prevEl['ClientId'] <= el['ClientId'] ? y : y + BOX_HEIGHT + 2 * LINE_BLEED,
            class: 'linearization-invalid linearization-line',
          })
          // current line
          const point = svgadd(g, 'line', {
            x1: x,
            x2: x,
            y1: y,
            y2: y + BOX_HEIGHT + 2 * LINE_BLEED,
            class: 'linearization-invalid linearization-point',
          })
          errorPoints.push({
            x: x,
            partition: partitionIndex,
            index: lin[lin.length - 1]['Index'], // NOTE not index
            element: point,
          })
          illegalLast[partitionIndex][linIndex].add(index)
          if (
            !Object.prototype.hasOwnProperty.call(largestIllegalLength[partitionIndex], index) ||
            largestIllegalLength[partitionIndex][index] < lin.length
          ) {
            largestIllegalLength[partitionIndex][index] = lin.length
            largestIllegal[partitionIndex][index] = linIndex
          }
        }
      })
    })
  })
  errorPoints.sort((a, b) => a.x - b.x)

  // attach targetRects
  svgattach(svg, targetRects)

  // tooltip
  const tooltip = document.getElementById('canvas').appendChild(document.createElement('div'))
  tooltip.setAttribute('class', 'tooltip')

  function handleMouseOver() {
    if (!selected) {
      const partition = parseInt(this.dataset['partition'])
      const index = parseInt(this.dataset['index'])
      highlight(partition, index)
    }
    tooltip.style.display = 'block'
  }

  function linearizationIndex(partition, index) {
    // show this linearization
    if (partition >= coreHistory.length) {
      // annotation
      return null
    }
    if (Object.prototype.hasOwnProperty.call(coreHistory[partition]['Largest'], index)) {
      return coreHistory[partition]['Largest'][index]
    } else if (Object.prototype.hasOwnProperty.call(largestIllegal[partition], index)) {
      return largestIllegal[partition][index]
    }
    return null
  }

  function highlight(partition, index) {
    // hide all but this partition
    historyLayers.forEach((layer, i) => {
      if (i === partition) {
        layer.classList.remove('hidden')
      } else {
        layer.classList.add('hidden')
      }
    })
    // hide all but the relevant linearization
    partialLayers.forEach((layer) => {
      layer.forEach((g) => {
        g.classList.add('hidden')
      })
    })
    // show this linearization
    const maxIndex = linearizationIndex(partition, index)
    if (maxIndex !== null) {
      partialLayers[partition][maxIndex].classList.remove('hidden')
    }
    updateJump()
  }

  let lastTooltip = [null, null, null, null, null]
  function handleMouseMove() {
    const partition = parseInt(this.dataset['partition'])
    const index = parseInt(this.dataset['index'])
    const [sPartition, sIndex] = selectedIndex
    const thisTooltip = [partition, index, selected, sPartition, sIndex]

    if (!arrayEq(lastTooltip, thisTooltip)) {
      let maxIndex
      if (!selected) {
        maxIndex = linearizationIndex(partition, index)
      } else {
        // if selected, show info relevant to the selected linearization
        maxIndex = linearizationIndex(sPartition, sIndex)
      }
      if (partition >= coreHistory.length) {
        // annotation
        const details = annotations[index]['Details']
        tooltip.innerHTML = details.length === 0 ? '&langle;no details&rangle;' : details
      } else if (selected && sPartition !== partition) {
        tooltip.innerHTML = 'Not part of selected partition.'
      } else if (maxIndex === null) {
        if (!selected) {
          tooltip.innerHTML = 'Not part of any partial linearization.'
        } else {
          tooltip.innerHTML = 'Selected element is not part of any partial linearization.'
        }
      } else {
        const lin = coreHistory[partition]['PartialLinearizations'][maxIndex]
        let prev = null,
          curr = null
        let found = false
        for (let i = 0; i < lin.length; i++) {
          prev = curr
          curr = lin[i]
          if (curr['Index'] === index) {
            found = true
            break
          }
        }
        let call = allData[partition]['History'][index]['Start']
        let ret = allData[partition]['History'][index]['OriginalEnd']
        let msg = ''
        if (found) {
          // part of linearization
          if (prev !== null) {
            msg = '<strong>Previous state:</strong><br>' + prev['StateDescription'] + '<br><br>'
          }
          msg +=
            '<strong>New state:</strong><br>' +
            curr['StateDescription'] +
            '<br><br>Call: ' +
            call +
            '<br><br>Return: ' +
            ret
        } else if (illegalLast[partition][maxIndex].has(index)) {
          // illegal next one
          msg =
            '<strong>Previous state:</strong><br>' +
            lin[lin.length - 1]['StateDescription'] +
            '<br><br><strong>New state:</strong><br>&langle;invalid op&rangle;' +
            '<br><br>Call: ' +
            call +
            '<br><br>Return: ' +
            ret
        } else {
          // not part of this one
          msg = "Not part of selected element's partial linearization."
        }
        tooltip.innerHTML = msg
      }
      lastTooltip = thisTooltip
    }
    // make sure tooltip doesn't overflow off the right side of the screen
    const maxX =
      document.documentElement.scrollLeft +
      document.documentElement.clientWidth -
      PADDING -
      tooltip.getBoundingClientRect().width
    tooltip.style.left = Math.min(event.pageX + 20, maxX) + 'px'
    tooltip.style.top = event.pageY + 20 + 'px'
  }

  function handleMouseOut() {
    if (!selected) {
      resetHighlight()
    }
    tooltip.style.display = 'none'
    lastTooltip = [null, null, null, null, null]
  }

  function resetHighlight() {
    // show all layers
    historyLayers.forEach((layer) => {
      layer.classList.remove('hidden')
    })
    // show longest linearizations, which are first
    partialLayers.forEach((layers) => {
      layers.forEach((l, i) => {
        if (i === 0) {
          l.classList.remove('hidden')
        } else {
          l.classList.add('hidden')
        }
      })
    })
    updateJump()
  }

  function updateJump() {
    const jump = document.getElementById('jump-link')
    // find first non-hidden point
    // feels a little hacky, but it works
    const point = errorPoints.find((pt) => !pt.element.parentElement.classList.contains('hidden'))
    if (point) {
      jump.classList.remove('inactive')
      jump.onclick = () => {
        point.element.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' })
        if (!selected) {
          select(point.partition, point.index)
        }
      }
    } else {
      jump.classList.add('inactive')
    }
  }

  function handleClick() {
    const partition = parseInt(this.dataset['partition'])
    const index = parseInt(this.dataset['index'])
    if (selected) {
      const [sPartition, sIndex] = selectedIndex
      if (partition === sPartition && index === sIndex) {
        deselect()
        return
      } else {
        historyRects[sPartition][sIndex].classList.remove('selected')
      }
    }
    select(partition, index)
  }

  function handleBgClick() {
    deselect()
  }

  function select(partition, index) {
    selected = true
    selectedIndex = [partition, index]
    highlight(partition, index)
    historyRects[partition][index].classList.add('selected')
  }

  function deselect() {
    if (!selected) {
      return
    }
    selected = false
    resetHighlight()
    const [partition, index] = selectedIndex
    historyRects[partition][index].classList.remove('selected')
  }

  handleMouseOut() // initialize, same as mouse out
}
