import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
import fetch_openimages as f

CLASSES = "/m/01\x2cStairs\n/m/02,Bollard\n/m/03,Person\n/m/04,Trash can\n"
HDR = "ImageID,Source,LabelName,Confidence,XMin,XMax,YMin,YMax,IsOccluded,IsTruncated,IsGroupOf,IsDepiction,IsInside\n"

def test_resolve_ignores_case_and_reports_missing():
    mids = f.read_classes(CLASSES.replace('\x2c', ','))
    m, missing = f.resolve({'stairs': ['stairs'], 'ashcan': ['Waste container', 'Trash can'], 'scooter': ['Scooter']}, mids)
    assert m == {'/m/01': 'stairs', '/m/04': 'ashcan'}
    assert missing == ['scooter']

def rows(*r):
    return (HDR + ''.join(r)).splitlines(keepends=True)

def test_collect_filters_groups_depictions_and_tiny_boxes_and_writes_yolo():
    lines = rows(
        'a,x,/m/01,1,0.1,0.5,0.2,0.8,0,0,0,0,0\n',      # good
        'b,x,/m/01,1,0.1,0.5,0.2,0.8,0,0,1,0,0\n',      # group
        'c,x,/m/01,1,0.1,0.5,0.2,0.8,0,0,0,1,0\n',      # drawing
        'd,x,/m/01,1,0.10,0.11,0.2,0.21,0,0,0,0,0\n',   # tiny
        'e,x,/m/03,1,0.1,0.5,0.2,0.8,0,0,0,0,0\n',      # a class we did not ask for
    )
    got, per = f.collect(lines, {'/m/01': 'stairs'}, ['stairs'], 10)
    assert list(got) == ['a'] and per['stairs'] == {'a'}
    assert got['a'] == ['0 0.300000 0.500000 0.400000 0.600000']

def test_per_class_cap_counts_pictures_not_boxes():
    lines = rows(*[f'img{i},x,/m/01,1,0.1,0.5,0.2,0.8,0,0,0,0,0\n' for i in range(5)] + ['img0,x,/m/01,1,0.5,0.9,0.2,0.8,0,0,0,0,0\n'])
    got, per = f.collect(lines, {'/m/01': 'stairs'}, ['stairs'], 3)
    assert sorted(got) == ['img0', 'img1', 'img2']
    assert len(got['img0']) == 2, 'a second box on a picture already chosen is still kept'
