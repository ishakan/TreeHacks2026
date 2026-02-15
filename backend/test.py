from preprocessing.main import preprocess_image

result = preprocess_image('preprocessing/fire_hydrant.jpg', 'sessions/test')
print(result['geometry_text'])
print('Composite saved to:', result['composite_path'])