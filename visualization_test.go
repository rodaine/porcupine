package porcupine

import (
	"os"
	"reflect"
	"testing"
)

func visualizeTempFile(t *testing.T, model Model, info LinearizationInfo) {
	file, err := os.CreateTemp("", "*.html")
	if err != nil {
		t.Fatalf("failed to create temp file")
	}
	err = Visualize(model, info, file)
	if err != nil {
		t.Fatalf("visualization failed")
	}
	t.Logf("wrote visualization to %s", file.Name())
}

func TestVisualizationMultipleLengths(t *testing.T) {
	ops := []Operation{
		{0, kvInput{op: 0, key: "x"}, 0, kvOutput{"w"}, 100},
		{1, kvInput{op: 1, key: "x", value: "y"}, 5, kvOutput{}, 10},
		{2, kvInput{op: 1, key: "x", value: "z"}, 0, kvOutput{}, 10},
		{1, kvInput{op: 0, key: "x"}, 20, kvOutput{"y"}, 30},
		{1, kvInput{op: 1, key: "x", value: "w"}, 35, kvOutput{}, 45},
		{5, kvInput{op: 0, key: "x"}, 25, kvOutput{"z"}, 35},
		{3, kvInput{op: 0, key: "x"}, 30, kvOutput{"y"}, 40},
		{4, kvInput{op: 0, key: "y"}, 50, kvOutput{"a"}, 90},
		{2, kvInput{op: 1, key: "y", value: "a"}, 55, kvOutput{}, 85},
	}
	res, info := CheckOperationsVerbose(kvModel, ops, 0)
	if res != Illegal {
		t.Fatalf("expected output %v, got output %v", Illegal, res)
	}
	data := computeVisualizationData(kvModel, info)
	expected := []partitionVisualizationData{{
		History: []historyElement{
			{ClientId: 0, Start: 0, End: 100, Description: "get('x') -> 'w'"},
			{ClientId: 1, Start: 5, End: 10, Description: "put('x', 'y')"},
			{ClientId: 2, Start: 0, End: 10, Description: "put('x', 'z')"},
			{ClientId: 1, Start: 20, End: 30, Description: "get('x') -> 'y'"},
			{ClientId: 1, Start: 35, End: 45, Description: "put('x', 'w')"},
			{ClientId: 5, Start: 25, End: 35, Description: "get('x') -> 'z'"},
			{ClientId: 3, Start: 30, End: 40, Description: "get('x') -> 'y'"},
		},
		PartialLinearizations: []partialLinearization{
			{{2, "z"}, {1, "y"}, {3, "y"}, {6, "y"}, {4, "w"}, {0, "w"}},
			{{1, "y"}, {2, "z"}, {5, "z"}},
		},
		Largest: map[int]int{0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 1, 6: 0},
	}, {
		History: []historyElement{
			{ClientId: 4, Start: 50, End: 90, Description: "get('y') -> 'a'"},
			{ClientId: 2, Start: 55, End: 85, Description: "put('y', 'a')"},
		},
		PartialLinearizations: []partialLinearization{
			{{1, "a"}, {0, "a"}},
		},
		Largest: map[int]int{0: 0, 1: 0},
	}}
	if !reflect.DeepEqual(expected, data.Partitions) {
		t.Fatalf("expected data to be \n%v\n, was \n%v", expected, data)
	}
	visualizeTempFile(t, kvModel, info)
}

func TestRegisterModelReadme(t *testing.T) {
	// basically the code from the README

	events := []Event{
		// C0: Write(100)
		{Kind: CallEvent, Value: registerInput{false, 100}, Id: 0, ClientId: 0},
		// C1: Read()
		{Kind: CallEvent, Value: registerInput{true, 0}, Id: 1, ClientId: 1},
		// C2: Read()
		{Kind: CallEvent, Value: registerInput{true, 0}, Id: 2, ClientId: 2},
		// C2: Completed Read -> 0
		{Kind: ReturnEvent, Value: 0, Id: 2, ClientId: 2},
		// C1: Completed Read -> 100
		{Kind: ReturnEvent, Value: 100, Id: 1, ClientId: 1},
		// C0: Completed Write
		{Kind: ReturnEvent, Value: 0, Id: 0, ClientId: 0},
	}

	res, info := CheckEventsVerbose(registerModel, events, 0)
	// returns true

	if res != Ok {
		t.Fatal("expected operations to be linearizable")
	}

	visualizeTempFile(t, registerModel, info)

	events = []Event{
		// C0: Write(200)
		{Kind: CallEvent, Value: registerInput{false, 200}, Id: 0, ClientId: 0},
		// C1: Read()
		{Kind: CallEvent, Value: registerInput{true, 0}, Id: 1, ClientId: 1},
		// C1: Completed Read -> 200
		{Kind: ReturnEvent, Value: 200, Id: 1, ClientId: 1},
		// C2: Read()
		{Kind: CallEvent, Value: registerInput{true, 0}, Id: 2, ClientId: 2},
		// C2: Completed Read -> 0
		{Kind: ReturnEvent, Value: 0, Id: 2, ClientId: 2},
		// C0: Completed Write
		{Kind: ReturnEvent, Value: 0, Id: 0, ClientId: 0},
	}

	res, info = CheckEventsVerbose(registerModel, events, 0)
	// returns false

	if res != Illegal {
		t.Fatal("expected operations not to be linearizable")
	}

	visualizeTempFile(t, registerModel, info)
}

func TestVisualizationLarge(t *testing.T) {
	events := parseJepsenLog("test_data/jepsen/etcd_070.log")
	res, info := CheckEventsVerbose(etcdModel, events, 0)
	if res != Illegal {
		t.Fatal("expected operations not to be linearizable")
	}

	visualizeTempFile(t, etcdModel, info)
}

func TestVisualizationAnnotations(t *testing.T) {
	// base set of operations same as TestVisualizationMultipleLengths
	ops := []Operation{
		{0, kvInput{op: 0, key: "x"}, 0, kvOutput{"w"}, 100},
		{1, kvInput{op: 1, key: "x", value: "y"}, 5, kvOutput{}, 10},
		{2, kvInput{op: 1, key: "x", value: "z"}, 0, kvOutput{}, 10},
		{1, kvInput{op: 0, key: "x"}, 20, kvOutput{"y"}, 30},
		{1, kvInput{op: 1, key: "x", value: "w"}, 35, kvOutput{}, 45},
		{5, kvInput{op: 0, key: "x"}, 25, kvOutput{"z"}, 35},
		{3, kvInput{op: 0, key: "x"}, 30, kvOutput{"y"}, 40},
		{4, kvInput{op: 0, key: "y"}, 50, kvOutput{"a"}, 90},
		{2, kvInput{op: 1, key: "y", value: "a"}, 55, kvOutput{}, 85},
	}
	res, info := CheckOperationsVerbose(kvModel, ops, 0)
	annotations := []Annotation{
		// let's say that there was a "failed get" by client 4 early on
		{ClientId: 4, Start: 10, End: 31, Description: "get('y') timeout", BackgroundColor: "#ff9191"},
		// and a failed get by client 5 later
		{ClientId: 5, Start: 80, Description: "get('x') timeout", BackgroundColor: "#ff9191"},
		// and some tagged annotations
		{Tag: "Server 1", Start: 30, Description: "leader", Details: "became leader in term 3 with 2 votes"},
		{Tag: "Server 3", Start: 10, Description: "duplicate", Details: "saw duplicate operation put('x', 'y')"},
		{Tag: "Server 2", Start: 80, Description: "restart"},
		{Tag: "Server 3", Start: 0, Description: "leader", Details: "became leader in term 1 with 3 votes"},
		// and some "test framework" annotations
		{Tag: "Test Framework", Start: 20, End: 35, Description: "partition [3] [1 2]", BackgroundColor: "#efaefc"},
		{Tag: "Test Framework", Start: 40, End: 100, Description: "partition [2] [1 3]", BackgroundColor: "#efaefc"},
	}
	info.AddAnnotations(annotations)
	if res != Illegal {
		t.Fatalf("expected output %v, got output %v", Illegal, res)
	}
	// we don't check much else here, this has to be visually inspected
	visualizeTempFile(t, kvModel, info)
}

func TestVisualizePointInTimeAnnotationsEnd(t *testing.T) {
	ops := []Operation{
		{0, kvInput{op: 0, key: "x"}, 0, kvOutput{"w"}, 100},
		{1, kvInput{op: 1, key: "x", value: "y"}, 50, kvOutput{}, 60},
	}
	res, info := CheckOperationsVerbose(kvModel, ops, 0)
	if res != Illegal {
		t.Fatalf("expected output %v, got output %v", Illegal, res)
	}
	annotations := []Annotation{
		{Tag: "Server 1", Start: 30, Description: "leader change", Details: "became leader"},
		{Tag: "Server 2", Start: 50, Description: "heartbeat"},
		// point-in-time annotation at the end
		{Tag: "Server 1", Start: 100, Description: "shutdown"},
		{Tag: "Test Framework", Start: 20, End: 40, Description: "network stable", BackgroundColor: "#efaefc"},
	}
	info.AddAnnotations(annotations)
	visualizeTempFile(t, kvModel, info)
}

func TestVisualizeMatchingStartEnd(t *testing.T) {
	ops := []Operation{
		{0, kvInput{op: 0, key: "x"}, 0, kvOutput{"w"}, 50},
		{1, kvInput{op: 1, key: "x", value: "y"}, 50, kvOutput{}, 80},
	}
	res, info := CheckOperationsVerbose(kvModel, ops, 0)
	if res != Illegal {
		t.Fatalf("expected output %v, got output %v", Illegal, res)
	}
	annotations := []Annotation{
		{Tag: "Test Framework", Start: 0, End: 20, Description: "partition"},
		{Tag: "Test Framework", Start: 20, End: 20, Description: "point in time 1"},
		{Tag: "Test Framework", Start: 20, End: 40, Description: "network stable"},
	}
	info.AddAnnotations(annotations)
	visualizeTempFile(t, kvModel, info)
}
