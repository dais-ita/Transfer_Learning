# Transfer_Learning
Transfer learning using inception_resnet_v2


This project obtained from https://github.com/kwotsin/transfer_learning_tutorial enables the application of a  transfer learning approach using a inception_resnet_v2 pre-trained model.


# Summary

Run create_tfrecord.py to create tfrecords.
	
Run train_dais.py for training and eval_dais.py for evaluation.

Images are stored in dais\dais_photos


### Requirements
1. Python 2.7.x
2. TensorFlow >= 0.12



**NOTE**: If you want to run this program on Python 3, clone and run `git checkout python-3.0` for the Python 3 branch instead.


### Arguments

#### Required arguments:

- dataset_dir (string): The directory to your dataset that is arranged in a structured way where your subdirectories keep classes of your images. 

For example:

    dais\
        dais_photos\
            cars\
                ....jpg
                ....jpg
                ....jpg
            empty_road\
                ....jpg
 
  Note: Your dataset_dir should be /path/to/dais and not /path/to/dais/dais_photos

- tfrecord_filename (string): The output name of your TFRecord files.
